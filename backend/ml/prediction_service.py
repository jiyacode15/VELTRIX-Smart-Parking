import json
from datetime import datetime, timedelta
from pathlib import Path
import joblib
import numpy as np

MODEL_DIR = Path(__file__).resolve().parent
MODEL_PATH = MODEL_DIR / "model.pkl"
METADATA_PATH = MODEL_DIR / "metadata.json"

_cached_model = None
_cached_metadata = None


def load_model():
    """Load the persisted model and metadata from disk."""
    global _cached_model, _cached_metadata
    if _cached_model is not None and _cached_metadata is not None:
        return _cached_model, _cached_metadata

    if not MODEL_PATH.exists() or not METADATA_PATH.exists():
        # Fallback or trigger training
        try:
            from backend.ml.train_model import train_and_persist_model
            _cached_metadata = train_and_persist_model()
            _cached_model = joblib.load(MODEL_PATH)
            return _cached_model, _cached_metadata
        except Exception as err:
            print(f"Warning: Unable to train/load model on the fly: {err}")
            return None, None

    try:
        _cached_model = joblib.load(MODEL_PATH)
        with open(METADATA_PATH, "r", encoding="utf-8") as f:
            _cached_metadata = json.load(f)
    except Exception as err:
        print(f"Error loading model from {MODEL_PATH}: {err}")
        return None, None

    return _cached_model, _cached_metadata


def get_model_diagnostics():
    """Return model diagnostic info, feature importances, and evaluation metrics."""
    _, meta = load_model()
    if not meta:
        return {
            "model_type": "RandomForestRegressor",
            "model_status": "uninitialized",
            "features_used": [],
            "feature_importances": {},
            "metrics": {"mae": None, "rmse": None, "r2": None},
            "training_dataset_size": 0,
            "trained_at": None,
            "sklearn_available": True,
            "numpy_available": True,
        }
    return {
        **meta,
        "model_status": "active",
        "sklearn_available": True,
        "numpy_available": True,
    }


def predict_for_facility(
    facility_id: int,
    total_capacity: int,
    current_available: int,
    recent_occupied_slots: list[int] | None = None,
    booking_count_24h: int = 0,
    base_time: datetime | None = None,
):
    """
    Generate multi-horizon ML predictions (0, 15, 30, 60, 120 minutes)
    using the persisted RandomForest model.
    """
    model, metadata = load_model()
    if base_time is None:
        base_time = datetime.utcnow()

    total_capacity = max(1, total_capacity)
    current_occupied = max(0, total_capacity - current_available)
    curr_ratio = current_occupied / total_capacity

    if recent_occupied_slots and len(recent_occupied_slots) > 0:
        recent_avg_ratio = sum(recent_occupied_slots) / (len(recent_occupied_slots) * total_capacity)
    else:
        recent_avg_ratio = curr_ratio

    horizons = [0, 15, 30, 60, 120]  # in minutes
    results = []

    for h in horizons:
        target_time = base_time + timedelta(minutes=h)
        hour = target_time.hour + (target_time.minute / 60.0)
        dow = target_time.weekday()
        is_weekend = 1 if dow in (5, 6) else 0

        if model is not None:
            feature_vector = np.array([[
                float(facility_id),
                float(hour),
                float(dow),
                float(is_weekend),
                float(total_capacity),
                float(curr_ratio),
                float(recent_avg_ratio),
                float(booking_count_24h),
                float(h),
            ]], dtype=float)
            try:
                pred_ratio = float(model.predict(feature_vector)[0])
            except Exception:
                pred_ratio = curr_ratio
        else:
            # Fallback deterministic demand curve
            pred_ratio = curr_ratio

        pred_ratio = max(0.01, min(0.99, pred_ratio))
        pred_occupied = int(round(total_capacity * pred_ratio))
        pred_occupied = max(0, min(total_capacity, pred_occupied))
        pred_available = max(0, total_capacity - pred_occupied)
        pred_occ_pct = round(pred_ratio * 100, 1)

        # Parking probability calculation:
        # Probability that an arriving user gets a slot depends on:
        # 1. Ratio of available slots to total capacity
        # 2. Absolute free capacity cushion
        # 3. Model error margin (from MAE)
        mae = metadata.get("metrics", {}).get("mae", 0.02) if metadata else 0.02
        available_fraction = pred_available / total_capacity
        if pred_available <= 0:
            prob = 0.02
        elif pred_occ_pct >= 95:
            prob = max(0.05, min(0.25, available_fraction * 3.0))
        elif pred_occ_pct >= 85:
            prob = max(0.20, min(0.60, 0.35 + available_fraction * 1.5))
        elif pred_occ_pct >= 70:
            prob = max(0.55, min(0.85, 0.60 + available_fraction * 1.2))
        else:
            prob = max(0.80, min(0.98, 0.82 + available_fraction * 0.5))

        # Adjust slightly for horizon uncertainty
        prob_discount = (h / 120.0) * (mae * 2.0)
        final_prob = max(0.01, min(0.99, round(prob - prob_discount, 2)))

        if final_prob >= 0.70:
            confidence = "High"
        elif final_prob >= 0.40:
            confidence = "Medium"
        else:
            confidence = "Low"

        results.append({
            "minutes": h,
            "target_time": target_time.isoformat(),
            "predicted_occupancy": pred_occ_pct,
            "predicted_occupied_slots": pred_occupied,
            "available_slots": pred_available,
            "parking_probability": final_prob,
            "confidence": confidence,
            "source": "ML PREDICTION" if model is not None else "LIMITED DATA",
        })

    return {
        "facility_id": facility_id,
        "total_capacity": total_capacity,
        "current_available": current_available,
        "current_occupancy_percent": round(curr_ratio * 100, 1),
        "predictions": results,
        "model_status": "ml_regression" if model is not None else "fallback",
        "model_type": metadata.get("model_type", "RandomForestRegressor") if metadata else "RandomForestRegressor",
        "evaluation": metadata.get("metrics") if metadata else None,
        "generated_at": datetime.utcnow().isoformat(),
    }
