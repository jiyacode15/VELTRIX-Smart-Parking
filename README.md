# VELTRIX — Smart Parking & Urban Mobility

Full-stack student project foundation: React/Vite frontend, FastAPI/SQLAlchemy API, SQLite database, and a transparent ML-ready occupancy prediction endpoint.

## Run

Use two terminals in this folder:

```powershell
npm run dev
py -m pip install -r backend/requirements.txt
npm run backend
```

Open `http://localhost:5173`. API documentation: `http://localhost:8000/docs`.

Demo admin login: `admin@veltrixparking.com` / `admin123`.

## Routes

Frontend: `/`, `/parking`, `/parking/:id`, `/intelligence`, `/dashboard`, `/management`, `/login`, `/signup`.

API: `GET /health`; `POST /api/auth/signup`; `POST /api/auth/login`; `GET /api/auth/me`; `GET /api/parking-areas`; `GET /api/parking-areas/{id}`; `PATCH /api/parking-areas/{id}/occupancy`; `GET /api/predictions/occupancy`.

Nearby search APIs: `GET /api/geocode?q=<destination>` proxies real OpenStreetMap Nominatim results, and `GET /api/parking/nearby?lat=<latitude>&lng=<longitude>&radius_km=5` returns only persisted parking records within the requested radius. The Nearby page uses Leaflet with OpenStreetMap tiles.

Booking APIs: `GET /api/parking-areas/{id}/slots`; `POST /api/bookings`; `GET /api/bookings?phone_number=<phone>`; `POST /api/bookings/{booking_id}/cancel`. Slot status is the availability source of truth and active reservations are protected by an atomic backend update.

Forecast API: `GET /api/parking/{parking_id}/prediction` returns current capacity plus 15-minute, 1-hour, and 2-hour expected available slots and availability probabilities. This repository does not contain a trained ML model. With enough occupancy logs, the endpoint uses a deterministic historical trend estimate; otherwise it uses the clearly labelled `data_driven_fallback` based on live slot state and active booking demand. It never invents percentages.

Copy `.env.example` to `.env` for local configuration. `NOMINATIM_USER_AGENT` is optional but recommended: set it to an identifying application name and contact address when using the public Nominatim service. The key is kept in the backend environment; no geocoding credential is exposed in the frontend.

## Database schema

- `users`: account and role
- `parking_areas`: capacity, occupancy and coordinates
- `parking_slots`: individual parking-space status
- `occupancy_logs`: timestamped historical occupancy data

## ML status

The prediction endpoint deliberately uses a labeled demo heuristic, not a trained model. Historical `occupancy_logs` are the dataset foundation. Next, collect more logs and inputs such as time/day, events and weather; train and evaluate a model in a `backend/app/ml` module; then replace only the demo calculation while preserving the existing API contract.
