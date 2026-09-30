from datetime import datetime, timedelta
from hashlib import pbkdf2_hmac
import json
import math
import os
import re
from pathlib import Path
import tempfile
import csv
import shutil
from secrets import token_hex
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

try:
    from sklearn.linear_model import LinearRegression
    from sklearn.metrics import mean_absolute_error, r2_score
except Exception:  # pragma: no cover
    LinearRegression = None
    mean_absolute_error = None
    r2_score = None

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    create_engine,
    func,
    select,
    update,
)
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
    sessionmaker,
)
from sqlalchemy.exc import IntegrityError


# =========================================================
# DATABASE SETUP
# =========================================================

class Base(DeclarativeBase):
    pass


ROOT = Path(__file__).resolve().parent.parent

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL:
    database_url = DATABASE_URL
elif os.getenv("VERCEL") == "1":
    # Vercel functions can write only to /tmp. Seed it from the packaged demo DB
    # on a cold start; this file is ephemeral and not durable across instances.
    runtime_db = Path(tempfile.gettempdir()) / "veltrix.db"
    if not runtime_db.exists() and (ROOT / "veltrix.db").exists():
        shutil.copy2(ROOT / "veltrix.db", runtime_db)
    database_url = f"sqlite:///{runtime_db}"
else:
    database_url = f"sqlite:///{ROOT / 'veltrix.db'}"

engine = create_engine(
    database_url,
    connect_args={"check_same_thread": False} if database_url.startswith("sqlite:") else {},
)


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
)


# =========================================================
# DATABASE MODELS
# =========================================================

class User(Base):

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    name: Mapped[str] = mapped_column(
        String(100)
    )

    email: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        index=True,
    )

    password_hash: Mapped[str] = mapped_column(
        String(255)
    )

    role: Mapped[str] = mapped_column(
        String(20),
        default="driver",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
    )


class UserToken(Base):

    __tablename__ = "user_tokens"

    token: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
    )


class ParkingArea(Base):

    __tablename__ = "parking_areas"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    code: Mapped[str] = mapped_column(
        String(50),
        unique=True,
        index=True,
    )

    name: Mapped[str] = mapped_column(
        String(120)
    )

    address: Mapped[str] = mapped_column(
        String(255)
    )

    latitude: Mapped[float] = mapped_column(
        Float
    )

    longitude: Mapped[float] = mapped_column(
        Float
    )

    total_slots: Mapped[int] = mapped_column(
        Integer
    )

    occupied_slots: Mapped[int] = mapped_column(
        Integer,
        default=0,
    )


class ParkingSlot(Base):

    __tablename__ = "parking_slots"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    parking_area_id: Mapped[int] = mapped_column(
        ForeignKey("parking_areas.id"),
        index=True,
    )

    slot_number: Mapped[str] = mapped_column(
        String(50)
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="available",
    )


class OccupancyLog(Base):

    __tablename__ = "occupancy_logs"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    parking_area_id: Mapped[int] = mapped_column(
        ForeignKey("parking_areas.id"),
        index=True,
    )

    occupied_slots: Mapped[int] = mapped_column(
        Integer
    )

    captured_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
        index=True,
    )

    source: Mapped[str] = mapped_column(
        String(50),
        default="admin",
    )


class Booking(Base):

    __tablename__ = "bookings"

    id: Mapped[int] = mapped_column(
        primary_key=True
    )

    booking_id: Mapped[str] = mapped_column(
        String(40),
        unique=True,
        index=True,
    )

    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )

    parking_id: Mapped[int] = mapped_column(
        ForeignKey("parking_areas.id"),
        index=True,
    )

    slot_id: Mapped[int] = mapped_column(
        ForeignKey("parking_slots.id"),
        index=True,
    )

    customer_name: Mapped[str] = mapped_column(
        String(100)
    )

    phone_number: Mapped[str] = mapped_column(
        String(20)
    )

    vehicle_number: Mapped[str] = mapped_column(
        String(20)
    )

    booking_time: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
    )

    start_time: Mapped[datetime] = mapped_column(
        DateTime
    )

    expiry_time: Mapped[datetime] = mapped_column(
        DateTime
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="BOOKED",
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
    )


Base.metadata.create_all(engine)


# =========================================================
# REQUEST MODELS
# =========================================================

class Signup(BaseModel):

    name: str = Field(
        min_length=2,
        max_length=100,
    )

    email: EmailStr

    password: str = Field(
        min_length=6,
        max_length=128,
    )


class Login(BaseModel):

    email: EmailStr

    password: str


class Update(BaseModel):

    occupied_slots: int = Field(
        ge=0
    )

    source: str = "admin"


class BookingRequest(BaseModel):

    parking_id: int = Field(gt=0)

    slot_id: int = Field(gt=0)

    customer_name: str = Field(
        min_length=2,
        max_length=100,
    )

    phone_number: str = Field(
        min_length=10,
        max_length=13,
    )

    vehicle_number: str = Field(
        min_length=4,
        max_length=20,
    )


class RoutePoint(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteAndParkingRequest(BaseModel):
    origin: RoutePoint
    destination: RoutePoint
    radius_km: float = Field(default=5.0, ge=0.5, le=25.0)
    arrival_minutes: int = Field(default=30, ge=0, le=180)


def clean_booking_fields(x: BookingRequest):
    name = " ".join(x.customer_name.split())
    phone = x.phone_number.replace(" ", "").replace("-", "")
    vehicle = "".join(x.vehicle_number.upper().split())

    if not re.fullmatch(
        r"[A-Za-z][A-Za-z .'-]{1,99}",
        name,
    ):
        raise HTTPException(
            status_code=422,
            detail="Enter a valid full name",
        )

    if not re.fullmatch(
        r"(?:\+91|91)?[6-9]\d{9}",
        phone,
    ):
        raise HTTPException(
            status_code=422,
            detail="Enter a valid Indian phone number",
        )

    if not re.fullmatch(
        r"[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}",
        vehicle,
    ):
        raise HTTPException(
            status_code=422,
            detail="Enter a valid Indian vehicle registration number",
        )

    return name, phone, vehicle


def expire_bookings(s: Session):
    now = datetime.utcnow()
    expired = s.scalars(
        select(Booking).where(
            Booking.status.in_(["BOOKED", "ACTIVE"]),
            Booking.expiry_time <= now,
        )
    ).all()

    for booking in expired:
        booking.status = "EXPIRED"
        s.execute(
            update(ParkingSlot)
            .where(ParkingSlot.id == booking.slot_id)
            .where(ParkingSlot.status == "BOOKED")
            .values(status="AVAILABLE")
        )

    if expired:
        s.commit()


def booking_out(
    booking: Booking,
    parking: ParkingArea,
    slot: ParkingSlot,
):
    return {
        "id": booking.id,
        "booking_id": booking.booking_id,
        "user_id": booking.user_id,
        "parking_id": parking.id,
        "parking_name": parking.name,
        "parking_address": parking.address,
        "slot_id": slot.id,
        "slot_number": slot.slot_number,
        "customer_name": booking.customer_name,
        "phone_number": booking.phone_number,
        "vehicle_number": booking.vehicle_number,
        "booking_time": booking.booking_time.isoformat(),
        "start_time": booking.start_time.isoformat(),
        "expiry_time": booking.expiry_time.isoformat(),
        "status": booking.status,
    }


def migrate_booking_table(engine):
    with engine.begin() as connection:
        indexes = connection.exec_driver_sql(
            "PRAGMA index_list('bookings')"
        ).fetchall()
        has_slot_status_constraint = False
        for index in indexes:
            if not index[2]:
                continue
            columns = connection.exec_driver_sql(
                f'PRAGMA index_info("{index[1]}")'
            ).fetchall()
            if [column[2] for column in columns] == [
                "slot_id",
                "status",
            ]:
                has_slot_status_constraint = True
                break

        if not has_slot_status_constraint:
            return

        connection.exec_driver_sql(
            "ALTER TABLE bookings RENAME TO bookings_legacy"
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE bookings (
                id INTEGER PRIMARY KEY,
                booking_id VARCHAR(40) NOT NULL UNIQUE,
                user_id INTEGER REFERENCES users(id),
                parking_id INTEGER NOT NULL REFERENCES parking_areas(id),
                slot_id INTEGER NOT NULL REFERENCES parking_slots(id),
                customer_name VARCHAR(100) NOT NULL,
                phone_number VARCHAR(20) NOT NULL,
                vehicle_number VARCHAR(20) NOT NULL,
                booking_time DATETIME NOT NULL,
                start_time DATETIME NOT NULL,
                expiry_time DATETIME NOT NULL,
                status VARCHAR(20) NOT NULL,
                created_at DATETIME NOT NULL
            )
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO bookings
            SELECT id, booking_id, user_id, parking_id, slot_id,
                   customer_name, phone_number, vehicle_number,
                   booking_time, start_time, expiry_time, status, created_at
            FROM bookings_legacy
            """
        )
        connection.exec_driver_sql(
            "DROP TABLE bookings_legacy"
        )


# =========================================================
# FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="VELTRIX API",
    version="1.0.0",
)


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,

    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        *[origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "").split(",") if origin.strip()],
    ],

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],
)


# =========================================================
# TEMPORARY TOKEN STORAGE
# =========================================================

tokens = {}


# =========================================================
# DATABASE SESSION
# =========================================================

def db():

    s = SessionLocal()

    try:
        yield s

    finally:
        s.close()


# =========================================================
# PASSWORD HASHING
# =========================================================

def h(password: str):

    return pbkdf2_hmac(
        "sha256",
        password.encode(),
        b"veltrix-student-demo-v1",
        260000,
    ).hex()


# =========================================================
# PARKING AREA RESPONSE
# =========================================================

def out(
    a: ParkingArea,
    distance_km: float | None = None,
    available_slots: int | None = None,
    occupied_slots: int | None = None,
):
    if available_slots is None:
        available_slots = max(
            0,
            a.total_slots - a.occupied_slots,
        )

    if occupied_slots is None:
        occupied_slots = max(
            0,
            a.total_slots - available_slots,
        )

    if a.total_slots > 0:

        pct = round(
            occupied_slots
            / a.total_slots
            * 100
        )

    else:

        pct = 0

    return {

        "id": a.id,

        "code": a.code,

        "name": a.name,

        "address": a.address,

        # REAL CSV COORDINATES
        "latitude": a.latitude,

        "longitude": a.longitude,

        "total_slots": a.total_slots,

        "occupied_slots": occupied_slots,

        "available_slots": available_slots,

        "occupancy_percent": pct,

        # Frontend can calculate actual distance
        # from destination/GPS coordinates.
        "distance_km": (
            round(distance_km, 3)
            if distance_km is not None
            else None
        ),

        "status": (
            "Almost full"
            if pct > 90

            else "Moderate"
            if pct > 75

            else "Available"
        ),
    }


def live_slot_counts(
    s: Session,
    parking_id: int,
):
    rows = s.execute(
        select(
            ParkingSlot.status,
            func.count(ParkingSlot.id),
        )
        .where(ParkingSlot.parking_area_id == parking_id)
        .group_by(ParkingSlot.status)
    ).all()

    if not rows:
        return None

    counts = {
        str(status).upper(): count
        for status, count in rows
    }
    available = counts.get("AVAILABLE", 0)
    occupied = sum(
        count
        for status, count in counts.items()
        if status != "AVAILABLE"
    )
    return available, occupied


def haversine_distance(
    latitude: float,
    longitude: float,
    other_latitude: float,
    other_longitude: float,
):
    radius_km = 6371
    latitude_delta = math.radians(
        other_latitude - latitude
    )
    longitude_delta = math.radians(
        other_longitude - longitude
    )
    first = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(math.radians(latitude))
        * math.cos(math.radians(other_latitude))
        * math.sin(longitude_delta / 2) ** 2
    )
    return radius_km * 2 * math.atan2(
        math.sqrt(first),
        math.sqrt(1 - first),
    )


# =========================================================
# AUTHENTICATION
# =========================================================

def get_user_from_token(token: str, s: Session) -> User | None:
    if not token:
        return None
    user_id = tokens.get(token)
    if not user_id:
        user_tok = s.get(UserToken, token)
        if user_tok:
            user_id = user_tok.user_id
            tokens[token] = user_id
    if user_id:
        return s.get(User, user_id)
    return None


def optional_user(
    authorization: str | None = Header(None),
    s: Session = Depends(db),
) -> User | None:
    token = (
        authorization
        .removeprefix("Bearer ")
        .strip()
        if authorization
        else ""
    )
    return get_user_from_token(token, s)


def user(
    authorization: str | None = Header(None),
    s: Session = Depends(db),
) -> User:
    u = optional_user(authorization, s)
    if not u:
        raise HTTPException(
            status_code=401,
            detail="Authentication required",
        )
    return u


def admin(
    u: User = Depends(user),
):
    if u.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required",
        )
    return u


# =========================================================
# STARTUP / DATABASE SEED
# =========================================================

@app.on_event("startup")
def seed():

    # -----------------------------------------------------
    # CREATE DATABASE TABLES
    # -----------------------------------------------------

    Base.metadata.create_all(engine)
    migrate_booking_table(engine)

    s = SessionLocal()

    try:

        # =================================================
        # 1. CREATE ADMIN ACCOUNT
        # =================================================

        admin_email = (
            "admin@veltrixparking.com"
        )

        existing_admin = s.scalar(

            select(User).where(

                User.email == admin_email

            )

        )

        if not existing_admin:

            s.add(

                User(

                    name="VELTRIX Administrator",

                    email=admin_email,

                    password_hash=h(
                        "admin123"
                    ),

                    role="admin",

                )

            )

            s.commit()

            print(
                "VELTRIX ADMIN ACCOUNT CREATED."
            )


        # =================================================
        # 2. FIND CSV FILE
        # =================================================

        csv_path = (

            ROOT
            / "data"
            / "mumbai_parking.csv"

        )

        print()
        print("========================================")
        print("VELTRIX PARKING DATA SYNC")
        print("========================================")

        print(
            "CSV PATH:",
            csv_path
        )

        print(
            "CSV EXISTS:",
            csv_path.exists()
        )


        if not csv_path.exists():

            print(
                "WARNING: Mumbai parking CSV not found."
            )

            return


        # =================================================
        # 3. READ CSV
        # =================================================

        csv_rows = []

        with csv_path.open(

            "r",

            encoding="utf-8-sig",

            newline="",

        ) as f:

            reader = csv.DictReader(f)

            print(
                "CSV COLUMNS:",
                reader.fieldnames
            )


            for row in reader:

                # -----------------------------------------
                # CSV ID
                # -----------------------------------------

                csv_id = (
                    row.get("id")
                    or ""
                ).strip()


                # -----------------------------------------
                # PARKING CODE
                # -----------------------------------------

                code = (

                    row.get("code")
                    or ""

                ).strip()


                if not code:

                    continue


                # -----------------------------------------
                # PARKING NAME
                # -----------------------------------------

                name = (

                    row.get("name")
                    or ""

                ).strip()


                if not name:

                    name = (
                        f"Parking Area {code}"
                    )


                # -----------------------------------------
                # ADDRESS
                # -----------------------------------------

                address = (
    row.get("address")
    or "Mumbai"
).strip()


                # -----------------------------------------
                # LATITUDE
                # -----------------------------------------

                try:

                    latitude = float(

                        row.get(
                            "latitude"
                        )

                        or 0

                    )

                except (
                    ValueError,
                    TypeError,
                ):

                    latitude = 0.0


                # -----------------------------------------
                # LONGITUDE
                # -----------------------------------------

                try:

                    longitude = float(

                        row.get(
                            "longitude"
                        )

                        or 0

                    )

                except (
                    ValueError,
                    TypeError,
                ):

                    longitude = 0.0


                # -----------------------------------------
                # TOTAL SLOTS
                # -----------------------------------------

                total_value = (

                    row.get(
                        "total_slots"
                    )

                    or ""

                ).strip()


                if total_value:

                    try:

                        total_slots = int(

                            float(
                                total_value
                            )

                        )

                    except (
                        ValueError,
                        TypeError,
                    ):

                        total_slots = 0

                else:

                    def get_int(field):

                        try:

                            return int(

                                float(

                                    row.get(
                                        field
                                    )

                                    or 0

                                )

                            )

                        except (
                            ValueError,
                            TypeError,
                        ):

                            return 0


                    lmv = get_int("lmv")

                    lcv = get_int("lcv")

                    hmv = get_int("hmv")


                    total_slots = (

                        lmv
                        + lcv
                        + hmv

                    )


                # -----------------------------------------
                # IGNORE INVALID RECORDS
                # -----------------------------------------

                if (

                    total_slots <= 0

                    or latitude == 0

                    or longitude == 0

                ):

                    continue


                # -----------------------------------------
                # SAVE VALID CSV RECORD
                # -----------------------------------------

                csv_rows.append({

                    "csv_id": csv_id,

                    "code": code,

                    "name": name,

                    "address": address,

                    "latitude": latitude,

                    "longitude": longitude,

                    "total_slots": total_slots,

                })


        print(
            "VALID CSV RECORDS:",
            len(csv_rows)
        )


        # =================================================
        # 4. LOAD EXISTING DATABASE RECORDS
        # =================================================

        existing_areas = s.scalars(

            select(ParkingArea).order_by(

                ParkingArea.id

            )

        ).all()


        print(

            "EXISTING DATABASE RECORDS:",

            len(existing_areas)

        )


        # =================================================
        # 5. IMPORTANT UNIQUE-CODE FIX
        # =================================================
        #
        # We temporarily rename ALL existing codes before
        # applying CSV codes.
        #
        # This prevents errors such as:
        #
        # UNIQUE constraint failed:
        # parking_areas.code
        #
        # when two existing records need to exchange
        # or reuse codes.
        #
        # =================================================

        for area in existing_areas:

            area.code = (
                f"__VELTRIX_TMP_{area.id}__"
            )

        s.flush()


        # =================================================
        # 6. CREATE UNIQUE CSV CODES
        # =================================================
        #
        # Example:
        #
        # C-44
        # C-44
        # C-44
        #
        # becomes:
        #
        # C-44
        # C-44-2
        # C-44-3
        #
        # =================================================

        used_codes = set()

        unique_codes = []


        for row in csv_rows:

            base_code = row["code"]

            final_code = base_code

            suffix = 2


            while final_code in used_codes:

                final_code = (
                    f"{base_code}-{suffix}"
                )

                suffix += 1


            used_codes.add(final_code)

            unique_codes.append(
                final_code
            )


        # =================================================
        # 7. MATCH EXISTING RECORDS
        # =================================================

        used_database_ids = set()

        used_csv_indexes = set()

        updated_count = 0


        # -------------------------------------------------
        # FIRST: MATCH USING CSV ID
        # -------------------------------------------------

        for csv_index, row in enumerate(csv_rows):

            csv_id = row["csv_id"]

            if not csv_id:
                continue


            try:

                database_id = int(csv_id)

            except (
                ValueError,
                TypeError,
            ):

                continue


            area = s.get(
                ParkingArea,
                database_id
            )


            if area is None:
                continue


            if area.id in used_database_ids:
                continue


            area.code = unique_codes[csv_index]

            area.name = row["name"]

            area.address = row["address"]

            area.latitude = row["latitude"]

            area.longitude = row["longitude"]

            area.total_slots = row["total_slots"]


            # Never allow occupancy to exceed capacity.
            if area.occupied_slots > area.total_slots:

                area.occupied_slots = (
                    area.total_slots
                )


            used_database_ids.add(
                area.id
            )

            used_csv_indexes.add(
                csv_index
            )

            updated_count += 1


        # -------------------------------------------------
        # SECOND: MATCH USING NAME
        # -------------------------------------------------

        for csv_index, row in enumerate(csv_rows):

            if csv_index in used_csv_indexes:
                continue


            match = None


            for area in existing_areas:

                if area.id in used_database_ids:
                    continue


                if (

                    area.name

                    and area.name.lower()
                    == row["name"].lower()

                ):

                    match = area

                    break


            if match is None:
                continue


            match.code = unique_codes[csv_index]

            match.name = row["name"]

            match.address = row["address"]

            match.latitude = row["latitude"]

            match.longitude = row["longitude"]

            match.total_slots = row["total_slots"]


            if match.occupied_slots > match.total_slots:

                match.occupied_slots = (
                    match.total_slots
                )


            used_database_ids.add(
                match.id
            )

            used_csv_indexes.add(
                csv_index
            )

            updated_count += 1


        # -------------------------------------------------
        # THIRD: POSITION-BASED FALLBACK
        # -------------------------------------------------
        #
        # This is useful for your current dataset because
        # the CSV and database both contain approximately
        # the same 92 records.
        #
        # -------------------------------------------------

        remaining_database = [

            area

            for area in existing_areas

            if area.id not in used_database_ids

        ]


        remaining_csv = [

            index

            for index in range(
                len(csv_rows)
            )

            if index not in used_csv_indexes

        ]


        for area, csv_index in zip(

            remaining_database,
            remaining_csv

        ):

            row = csv_rows[csv_index]


            area.code = unique_codes[csv_index]

            area.name = row["name"]

            area.address = row["address"]

            area.latitude = row["latitude"]

            area.longitude = row["longitude"]

            area.total_slots = row["total_slots"]


            if area.occupied_slots > area.total_slots:

                area.occupied_slots = (
                    area.total_slots
                )


            used_database_ids.add(
                area.id
            )

            used_csv_indexes.add(
                csv_index
            )

            updated_count += 1


        # =================================================
        # 8. INSERT MISSING RECORDS
        # =================================================

        inserted_count = 0


        for csv_index, row in enumerate(csv_rows):

            if csv_index in used_csv_indexes:

                continue


            parking = ParkingArea(

                code=unique_codes[csv_index],

                name=row["name"],

                address=row["address"],

                latitude=row["latitude"],

                longitude=row["longitude"],

                total_slots=row["total_slots"],

                occupied_slots=0,

            )


            s.add(parking)

            inserted_count += 1


        # =================================================
        # 9. SAVE DATABASE
        # =================================================

        s.commit()

        # =================================================
        # 10. VERIFY DATABASE
        # =================================================

        final_areas = s.scalars(

            select(ParkingArea).order_by(

                ParkingArea.id

            )

        ).all()

        # Materialize the existing aggregate capacity as real slot rows once.
        # Existing records are preserved; this only fills the missing slot table.
        for area in final_areas:
            slot_count = s.scalar(
                select(func.count(ParkingSlot.id)).where(
                    ParkingSlot.parking_area_id == area.id
                )
            )

            if slot_count:
                continue

            s.add_all(
                [
                    ParkingSlot(
                        parking_area_id=area.id,
                        slot_number=f"{area.code}-{index + 1:04d}",
                        status=(
                            "OCCUPIED"
                            if index < area.occupied_slots
                            else "AVAILABLE"
                        ),
                    )
                    for index in range(area.total_slots)
                ]
            )

        s.commit()


        final_codes = [

            area.code

            for area in final_areas

        ]


        unique_code_count = len(
            set(final_codes)
        )


        # =================================================
        # 11. FINAL STATUS
        # =================================================

        print()

        print(
            "========================================"
        )

        print(

            "PARKING RECORDS UPDATED:",

            updated_count

        )

        print(

            "PARKING RECORDS INSERTED:",

            inserted_count

        )

        print(

            "TOTAL DATABASE RECORDS:",

            len(final_areas)

        )

        print(

            "UNIQUE PARKING CODES:",

            unique_code_count

        )

        print(

            "PARKING DATA SYNC COMPLETE"

        )

        print(
            "========================================"
        )

        print()


    except Exception as error:

        s.rollback()

        print()

        print(
            "PARKING DATA SYNC ERROR:",
            error
        )

        print()

        # Do not hide the error.
        # This makes debugging easier.
        raise


    finally:

        s.close()


# =========================================================
# HEALTH CHECK
# =========================================================

@app.get("/health")
@app.get("/api/health")
def health():

    return {

        "status": "online",

        "database": "sqlite",

        "parking_data":
            "Mumbai CSV dataset",

        "ml_model": (
            "LinearRegression (sklearn)"
            if LinearRegression is not None
            else "demo heuristic - not trained"
        ),

    }


# =========================================================
# SIGNUP
# =========================================================

@app.post("/api/auth/signup")
def signup(

    x: Signup,

    s: Session = Depends(db),

):

    existing = s.scalar(

        select(User).where(

            User.email == x.email

        )

    )


    if existing:

        raise HTTPException(

            status_code=409,

            detail=(
                "An account with this email "
                "already exists"
            ),

        )


    u = User(

        name=x.name,

        email=x.email,

        password_hash=h(x.password),

        role="driver",

    )


    s.add(u)

    s.commit()

    s.refresh(u)


    token = token_hex(24)
    tokens[token] = u.id
    s.add(UserToken(token=token, user_id=u.id))
    s.commit()

    return {
        "token": token,
        "user": {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
        },
    }


# =========================================================
# LOGIN
# =========================================================

@app.post("/api/auth/login")
def login(
    x: Login,
    s: Session = Depends(db),
):
    u = s.scalar(
        select(User).where(
            User.email == x.email
        )
    )

    if (
        not u
        or u.password_hash
        != h(x.password)
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password",
        )

    token = token_hex(24)
    tokens[token] = u.id
    s.add(UserToken(token=token, user_id=u.id))
    s.commit()


    return {

        "token": token,

        "user": {

            "id": u.id,

            "name": u.name,

            "email": u.email,

            "role": u.role,

        },

    }


# =========================================================
# CURRENT USER
# =========================================================

@app.get("/api/auth/me")
def me(

    u: User = Depends(user),

):

    return {

        "id": u.id,

        "name": u.name,

        "email": u.email,

        "role": u.role,

    }


# =========================================================
# REAL DESTINATION GEOCODING
# =========================================================

@app.get("/api/geocode")
def geocode(
    q: str = Query(
        min_length=2,
        max_length=200,
    ),
    s: Session = Depends(db),
):
    query = q.strip()

    if not query:
        raise HTTPException(
            status_code=400,
            detail="A destination is required",
        )

    queries = [query]
    without_honorific = re.sub(
        r"^(?:shree|sri|dr)\b[\s,.]*",
        "",
        query,
        flags=re.IGNORECASE,
    ).strip()

    if without_honorific and without_honorific != query:
        queries.append(without_honorific)

    data = []
    for search_query in queries:
        params = urlencode({
            "format": "jsonv2",
            "addressdetails": 1,
            "namedetails": 1,
            "limit": 8,
            "countrycodes": "in",
            "q": search_query,
        })
        request = Request(
            f"https://nominatim.openstreetmap.org/search?{params}",
            headers={
                "Accept": "application/json",
                "User-Agent": os.getenv(
                    "NOMINATIM_USER_AGENT",
                    "VELTRIX-Smart-Parking/1.0",
                ),
            },
        )

        try:
            with urlopen(request, timeout=5) as response:
                data = json.loads(
                    response.read().decode("utf-8")
                )
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
            data = []

        if isinstance(data, list) and data:
            break

    results = []
    if isinstance(data, list):
        for item in data:
            namedetails = item.get("namedetails") or {}

            try:
                latitude = float(item["lat"])
                longitude = float(item["lon"])
            except (KeyError, TypeError, ValueError):
                continue

            results.append({
                "place_id": item.get("place_id"),
                "name": (
                    namedetails.get("name")
                    or item.get("name")
                    or query
                ),
                "display_name": item.get(
                    "display_name",
                    "Location found",
                ),
                "type": item.get("type") or item.get(
                    "class",
                    "place",
                ),
                "latitude": latitude,
                "longitude": longitude,
                "address": item.get("address", {}),
            })

    # If geocoder returned no matches or network failed, fallback to matching database parking locations
    if not results:
        local_areas = s.scalars(
            select(ParkingArea)
            .where(
                (ParkingArea.name.ilike(f"%{query}%"))
                | (ParkingArea.address.ilike(f"%{query}%"))
                | (ParkingArea.code.ilike(f"%{query}%"))
            )
            .limit(8)
        ).all()
        for area in local_areas:
            results.append({
                "place_id": f"area-{area.id}",
                "name": area.name,
                "display_name": f"{area.name}, {area.address}",
                "type": "parking",
                "latitude": area.latitude,
                "longitude": area.longitude,
                "address": {"city": "Mumbai", "road": area.address},
            })

    return results


# =========================================================
# ALL PARKING AREAS
# =========================================================

@app.get("/api/parking-areas")
def areas(

    s: Session = Depends(db),

):

    parking_areas = s.scalars(

        select(ParkingArea).order_by(

            ParkingArea.id

        )

    ).all()


    response = []
    for area in parking_areas:
        counts = live_slot_counts(s, area.id)
        response.append(
            out(
                area,
                available_slots=counts[0] if counts else None,
                occupied_slots=counts[1] if counts else None,
            )
        )
    return response


# =========================================================
# NEARBY REAL PARKING AREAS
# =========================================================

@app.get("/api/parking/nearby")
def nearby_areas(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius_km: float = Query(
        default=5,
        gt=0,
        le=100,
    ),
    s: Session = Depends(db),
):
    nearby = []

    parking_areas = s.scalars(
        select(ParkingArea)
    ).all()

    for area in parking_areas:
        if not (
            math.isfinite(area.latitude)
            and math.isfinite(area.longitude)
            and area.latitude != 0
            and area.longitude != 0
        ):
            continue

        distance = haversine_distance(
            lat,
            lng,
            area.latitude,
            area.longitude,
        )

        if distance <= radius_km:
            nearby.append((distance, area))

    nearby.sort(key=lambda item: item[0])

    response = []
    for distance, area in nearby:
        counts = live_slot_counts(s, area.id)
        response.append(
            out(
                area,
                distance,
                available_slots=counts[0] if counts else None,
                occupied_slots=counts[1] if counts else None,
            )
        )
    return response


# =========================================================
# SINGLE PARKING AREA
# =========================================================

@app.get(
    "/api/parking-areas/{area_id}"
)
def area(

    area_id: int,

    s: Session = Depends(db),

):

    a = s.get(

        ParkingArea,

        area_id,

    )


    if not a:

        raise HTTPException(

            status_code=404,

            detail="Parking area not found",

        )


    counts = live_slot_counts(s, a.id)
    return out(
        a,
        available_slots=counts[0] if counts else None,
        occupied_slots=counts[1] if counts else None,
    )


# =========================================================
# REAL PARKING SLOTS
# =========================================================

@app.get("/api/parking-areas/{area_id}/slots")
def slots(
    area_id: int,
    s: Session = Depends(db),
):
    parking = s.get(ParkingArea, area_id)

    if not parking:
        raise HTTPException(
            status_code=404,
            detail="Parking area not found",
        )

    expire_bookings(s)
    parking_slots = s.scalars(
        select(ParkingSlot)
        .where(ParkingSlot.parking_area_id == area_id)
        .order_by(ParkingSlot.id)
    ).all()

    return [
        {
            "id": slot.id,
            "parking_id": slot.parking_area_id,
            "slot_number": slot.slot_number,
            "status": slot.status.upper(),
        }
        for slot in parking_slots
    ]


# =========================================================
# BOOKINGS
# =========================================================

@app.post("/api/bookings", status_code=201)
def create_booking(
    x: BookingRequest,
    s: Session = Depends(db),
    current_user: User | None = Depends(optional_user),
):
    name, phone, vehicle = clean_booking_fields(x)
    expire_bookings(s)
    parking = s.get(ParkingArea, x.parking_id)
    slot = s.get(ParkingSlot, x.slot_id)

    if not parking or not slot or slot.parking_area_id != parking.id:
        raise HTTPException(
            status_code=404,
            detail="Parking slot not found",
        )

    now = datetime.utcnow()
    expiry = now + timedelta(hours=2)
    changed = s.execute(
        update(ParkingSlot)
        .where(ParkingSlot.id == slot.id)
        .where(ParkingSlot.status.in_(["AVAILABLE", "available"]))
        .values(status="BOOKED")
    ).rowcount

    if changed != 1:
        s.rollback()
        raise HTTPException(
            status_code=409,
            detail="This slot was just booked by another user. Please select another slot.",
        )

    booking = Booking(
        booking_id=f"SP-{now:%Y%m%d}-{token_hex(5).upper()}",
        user_id=current_user.id if current_user else None,
        parking_id=parking.id,
        slot_id=slot.id,
        customer_name=name,
        phone_number=phone,
        vehicle_number=vehicle,
        booking_time=now,
        start_time=now,
        expiry_time=expiry,
        status="BOOKED",
    )
    s.add(booking)

    try:
        s.commit()
    except IntegrityError as error:
        s.rollback()
        raise HTTPException(
            status_code=409,
            detail="This slot was just booked by another user. Please select another slot.",
        ) from error

    s.refresh(booking)
    slot.status = "BOOKED"
    return booking_out(booking, parking, slot)


@app.get("/api/bookings")
def bookings(
    phone_number: str | None = Query(None, min_length=10, max_length=13),
    s: Session = Depends(db),
    current_user: User | None = Depends(optional_user),
):
    expire_bookings(s)
    if phone_number:
        phone = phone_number.replace(" ", "").replace("-", "")
        stmt = (
            select(Booking, ParkingArea, ParkingSlot)
            .join(ParkingArea, ParkingArea.id == Booking.parking_id)
            .join(ParkingSlot, ParkingSlot.id == Booking.slot_id)
            .where(Booking.phone_number == phone)
            .order_by(Booking.created_at.desc())
        )
    elif current_user:
        stmt = (
            select(Booking, ParkingArea, ParkingSlot)
            .join(ParkingArea, ParkingArea.id == Booking.parking_id)
            .join(ParkingSlot, ParkingSlot.id == Booking.slot_id)
            .where(Booking.user_id == current_user.id)
            .order_by(Booking.created_at.desc())
        )
    else:
        return []

    rows = s.execute(stmt).all()
    return [
        booking_out(booking, parking, slot)
        for booking, parking, slot in rows
    ]


@app.post("/api/bookings/{booking_id}/cancel")
def cancel_booking(
    booking_id: str,
    phone_number: str | None = Query(None),
    s: Session = Depends(db),
    current_user: User | None = Depends(optional_user),
):
    expire_bookings(s)
    stmt = select(Booking).where(Booking.booking_id == booking_id)
    if phone_number:
        phone = phone_number.replace(" ", "").replace("-", "")
        stmt = stmt.where(Booking.phone_number == phone)
    elif current_user:
        if current_user.role != "admin":
            stmt = stmt.where(Booking.user_id == current_user.id)
    else:
        raise HTTPException(
            status_code=400,
            detail="Phone number or authentication required to cancel booking",
        )

    booking = s.scalar(stmt)

    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    if booking.status not in ["BOOKED", "ACTIVE"]:
        raise HTTPException(
            status_code=409,
            detail="This booking cannot be cancelled",
        )

    booking.status = "CANCELLED"
    s.execute(
        update(ParkingSlot)
        .where(ParkingSlot.id == booking.slot_id)
        .where(ParkingSlot.status == "BOOKED")
        .values(status="AVAILABLE")
    )
    s.commit()
    parking = s.get(ParkingArea, booking.parking_id)
    slot = s.get(ParkingSlot, booking.slot_id)
    return booking_out(booking, parking, slot)


# =========================================================
# DASHBOARD OVERVIEW & ANALYTICS
# =========================================================

@app.get("/api/dashboard/overview")
def dashboard_overview(
    s: Session = Depends(db),
):
    expire_bookings(s)
    total_areas = s.scalar(select(func.count(ParkingArea.id))) or 0
    total_slots = s.scalar(select(func.count(ParkingSlot.id))) or 0
    available_slots = s.scalar(
        select(func.count(ParkingSlot.id)).where(ParkingSlot.status == "AVAILABLE")
    ) or 0
    occupied_slots = total_slots - available_slots
    total_bookings = s.scalar(select(func.count(Booking.id))) or 0
    active_bookings = s.scalar(
        select(func.count(Booking.id)).where(Booking.status.in_(["BOOKED", "ACTIVE"]))
    ) or 0

    recent_bookings = s.execute(
        select(Booking, ParkingArea, ParkingSlot)
        .join(ParkingArea, ParkingArea.id == Booking.parking_id)
        .join(ParkingSlot, ParkingSlot.id == Booking.slot_id)
        .order_by(Booking.created_at.desc())
        .limit(8)
    ).all()

    activity = []
    for b, p, sl in recent_bookings:
        status_label = "Reserved" if b.status in ["BOOKED", "ACTIVE"] else b.status.title()
        activity.append({
            "id": f"b-{b.id}",
            "time": b.created_at.strftime("%b %d, %H:%M") if b.created_at else "Recent",
            "place": p.name,
            "slot": sl.slot_number,
            "status": b.status,
            "detail": f"Slot {sl.slot_number} · {status_label} by {b.customer_name} ({b.vehicle_number})",
        })

    recent_logs = s.execute(
        select(OccupancyLog, ParkingArea)
        .join(ParkingArea, ParkingArea.id == OccupancyLog.parking_area_id)
        .order_by(OccupancyLog.captured_at.desc())
        .limit(4)
    ).all()
    for log, p in recent_logs:
        activity.append({
            "id": f"log-{log.id}",
            "time": log.captured_at.strftime("%b %d, %H:%M") if log.captured_at else "Recent",
            "place": p.name,
            "slot": "Facility Update",
            "status": "LOG",
            "detail": f"Occupancy adjusted to {log.occupied_slots} slots ({log.source})",
        })

    return {
        "total_facilities": total_areas,
        "total_capacity": total_slots,
        "available_slots": available_slots,
        "occupied_slots": occupied_slots,
        "occupancy_percent": round(occupied_slots / total_slots * 100, 1) if total_slots else 0,
        "total_bookings": total_bookings,
        "active_bookings": active_bookings,
        "recent_activity": activity,
    }


# =========================================================
# ADMIN ENDPOINTS
# =========================================================

@app.get("/api/admin/stats")
def admin_stats(
    s: Session = Depends(db),
    _: User = Depends(admin),
):
    expire_bookings(s)
    total_areas = s.scalar(select(func.count(ParkingArea.id))) or 0
    total_slots = s.scalar(select(func.count(ParkingSlot.id))) or 0
    available_slots = s.scalar(
        select(func.count(ParkingSlot.id)).where(ParkingSlot.status == "AVAILABLE")
    ) or 0
    booked_slots = s.scalar(
        select(func.count(ParkingSlot.id)).where(ParkingSlot.status == "BOOKED")
    ) or 0
    occupied_slots = total_slots - available_slots
    total_bookings = s.scalar(select(func.count(Booking.id))) or 0
    active_bookings = s.scalar(
        select(func.count(Booking.id)).where(Booking.status.in_(["BOOKED", "ACTIVE"]))
    ) or 0
    cancelled_bookings = s.scalar(
        select(func.count(Booking.id)).where(Booking.status == "CANCELLED")
    ) or 0
    total_users = s.scalar(select(func.count(User.id))) or 0
    total_occupancy_logs = s.scalar(select(func.count(OccupancyLog.id))) or 0

    return {
        "total_facilities": total_areas,
        "total_capacity": total_slots,
        "available_slots": available_slots,
        "occupied_slots": occupied_slots,
        "booked_slots": booked_slots,
        "occupancy_percent": round(occupied_slots / total_slots * 100, 1) if total_slots else 0,
        "total_bookings": total_bookings,
        "active_bookings": active_bookings,
        "cancelled_bookings": cancelled_bookings,
        "total_users": total_users,
        "total_occupancy_logs": total_occupancy_logs,
    }


@app.get("/api/admin/bookings")
def admin_bookings(
    status: str | None = Query(None),
    s: Session = Depends(db),
    _: User = Depends(admin),
):
    expire_bookings(s)
    stmt = (
        select(Booking, ParkingArea, ParkingSlot)
        .join(ParkingArea, ParkingArea.id == Booking.parking_id)
        .join(ParkingSlot, ParkingSlot.id == Booking.slot_id)
    )
    if status and status.upper() != "ALL":
        stmt = stmt.where(Booking.status == status.upper())
    stmt = stmt.order_by(Booking.created_at.desc())
    rows = s.execute(stmt).all()
    return [booking_out(booking, parking, slot) for booking, parking, slot in rows]


@app.get("/api/admin/users")
def admin_users(
    s: Session = Depends(db),
    _: User = Depends(admin),
):
    users_list = s.scalars(select(User).order_by(User.id)).all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users_list
    ]


# =========================================================
# UPDATE OCCUPANCY
# =========================================================

@app.patch(
    "/api/parking-areas/{area_id}/occupancy"
)
def occupancy(

    area_id: int,

    x: Update,

    s: Session = Depends(db),

    _: User = Depends(admin),

):

    a = s.get(

        ParkingArea,

        area_id,

    )


    if not a:

        raise HTTPException(

            status_code=404,

            detail="Parking area not found",

        )


    if x.occupied_slots > a.total_slots:

        raise HTTPException(

            status_code=422,

            detail=(
                "Occupied slots cannot "
                "exceed capacity"
            ),

        )


    # Update current occupancy

    a.occupied_slots = (
        x.occupied_slots
    )

    parking_slots = s.scalars(
        select(ParkingSlot)
        .where(ParkingSlot.parking_area_id == a.id)
        .where(ParkingSlot.status != "BOOKED")
        .order_by(ParkingSlot.id)
    ).all()
    booked_count = s.scalar(
        select(func.count(ParkingSlot.id)).where(
            ParkingSlot.parking_area_id == a.id,
            ParkingSlot.status == "BOOKED",
        )
    ) or 0
    target_occupied = max(
        0,
        x.occupied_slots - booked_count,
    )
    for index, slot in enumerate(parking_slots):
        slot.status = (
            "OCCUPIED"
            if index < target_occupied
            else "AVAILABLE"
        )


    # Save occupancy history

    s.add(

        OccupancyLog(

            parking_area_id=a.id,

            occupied_slots=(
                x.occupied_slots
            ),

            source=x.source,

        )

    )


    s.commit()

    s.refresh(a)


    counts = live_slot_counts(s, a.id)
    return out(
        a,
        available_slots=counts[0] if counts else None,
        occupied_slots=counts[1] if counts else None,
    )


# =========================================================
# OCCUPANCY PREDICTION
# =========================================================

def _predict_with_ml(
    s: Session,
    parking: ParkingArea,
    arrival_time: datetime,
):
    logs = s.scalars(
        select(OccupancyLog)
        .where(OccupancyLog.parking_area_id == parking.id)
        .order_by(OccupancyLog.captured_at.desc())
        .limit(48)
    ).all()

    if not logs or LinearRegression is None or np is None:
        return {
            "model_status": "fallback",
            "confidence": "Low",
            "confidence_score": 0.38,
            "probability_of_parking": 0.0,
            "predicted_available_slots": 0,
            "predicted_occupied_slots": parking.total_slots,
            "predicted_occupancy_percent": 100.0,
            "message": "Limited historical dataset; using current demand and trend fallback for this facility.",
            "evaluation": {
                "r2": None,
                "mae": None,
                "rmse": None,
            },
            "generated_at": datetime.utcnow().isoformat(),
        }

    recent_logs = sorted(logs, key=lambda item: item.captured_at)
    current_counts = live_slot_counts(s, parking.id) or (0, parking.total_slots)
    current_available = current_counts[0]
    current_occupied = max(0, parking.total_slots - current_available)

    latest = recent_logs[-1]
    previous = recent_logs[-2] if len(recent_logs) > 1 else latest
    hour_value = arrival_time.hour + (arrival_time.minute / 60)
    day_of_week = arrival_time.weekday()
    trend = latest.occupied_slots - previous.occupied_slots
    occupancy_ratio = current_occupied / parking.total_slots if parking.total_slots else 0
    recent_average = sum(item.occupied_slots for item in recent_logs[-6:]) / max(1, min(6, len(recent_logs)))
    recent_bookings = s.scalar(
        select(func.count(Booking.id)).where(
            Booking.parking_id == parking.id,
            Booking.status.in_(["BOOKED", "ACTIVE"]),
            Booking.created_at >= arrival_time - timedelta(hours=24),
            Booking.created_at <= arrival_time,
        )
    ) or 0

    features = []
    targets = []
    for record in recent_logs:
        record_hour = record.captured_at.hour + (record.captured_at.minute / 60)
        record_day = record.captured_at.weekday()
        record_occupancy = record.occupied_slots / parking.total_slots if parking.total_slots else 0
        record_recent_average = sum(item.occupied_slots for item in recent_logs[max(0, len(recent_logs) - 6):]) / max(1, min(6, len(recent_logs)))
        features.append([
            record_hour,
            record_day,
            record_occupancy,
            record_recent_average / max(1, parking.total_slots),
            recent_bookings,
            parking.total_slots,
        ])
        targets.append(record.occupied_slots)

    if len(features) < 3:
        return {
            "model_status": "fallback",
            "confidence": "Low",
            "confidence_score": 0.35,
            "probability_of_parking": 0.0,
            "predicted_available_slots": 0,
            "predicted_occupied_slots": parking.total_slots,
            "predicted_occupancy_percent": 100.0,
            "message": "Insufficient historical occupancy samples to train a robust model; fallback logic used.",
            "evaluation": {
                "r2": None,
                "mae": None,
                "rmse": None,
            },
            "generated_at": datetime.utcnow().isoformat(),
        }

    X = np.array(features, dtype=float)
    y = np.array(targets, dtype=float)
    model = LinearRegression()
    model.fit(X, y)
    arrival_features = np.array([[
        hour_value,
        day_of_week,
        occupancy_ratio,
        recent_average / max(1, parking.total_slots),
        recent_bookings,
        parking.total_slots,
    ]], dtype=float)
    predicted_occupied = float(model.predict(arrival_features)[0])
    predicted_occupied = max(0, min(parking.total_slots, predicted_occupied))
    predicted_available = max(0, parking.total_slots - predicted_occupied)
    predicted_occupancy_pct = (predicted_occupied / parking.total_slots * 100) if parking.total_slots else 0.0

    predictions = model.predict(X)
    mae = float(mean_absolute_error(y, predictions)) if mean_absolute_error is not None else None
    rmse = float((np.mean((y - predictions) ** 2)) ** 0.5) if np is not None else None
    r2 = float(r2_score(y, predictions)) if r2_score is not None else None

    availability_probability = max(
        0.0,
        min(
            1.0,
            (predicted_available / max(1, parking.total_slots)) * (0.9 if mae is None or mae <= 12 else 0.65),
        ),
    )
    if predicted_occupancy_pct >= 90:
        confidence_label = "Low"
        confidence_score = max(0.25, min(0.65, availability_probability))
    elif predicted_occupancy_pct >= 75:
        confidence_label = "Medium"
        confidence_score = max(0.45, min(0.8, availability_probability + 0.15))
    else:
        confidence_label = "High"
        confidence_score = max(0.55, min(0.95, availability_probability + 0.2))

    return {
        "model_status": "ml_regression",
        "confidence": confidence_label,
        "confidence_score": round(confidence_score, 3),
        "probability_of_parking": round(availability_probability, 3),
        "predicted_available_slots": int(round(predicted_available)),
        "predicted_occupied_slots": int(round(predicted_occupied)),
        "predicted_occupancy_percent": round(predicted_occupancy_pct, 2),
        "message": "Forecast generated from historical occupancy logs, current demand, and booking trend.",
        "evaluation": {
            "r2": round(r2, 4) if r2 is not None else None,
            "mae": round(mae, 2) if mae is not None else None,
            "rmse": round(rmse, 2) if rmse is not None else None,
        },
        "generated_at": datetime.utcnow().isoformat(),
    }


@app.get("/api/parking/{parking_id}/prediction")
def parking_prediction(
    parking_id: int,
    s: Session = Depends(db),
):
    parking = s.get(ParkingArea, parking_id)

    if not parking:
        raise HTTPException(
            status_code=404,
            detail="Parking area not found",
        )

    counts = live_slot_counts(s, parking.id)
    current_available = (
        counts[0]
        if counts
        else max(0, parking.total_slots - parking.occupied_slots)
    )
    current_occupied = parking.total_slots - current_available
    logs = s.scalars(
        select(OccupancyLog)
        .where(OccupancyLog.parking_area_id == parking_id)
        .order_by(OccupancyLog.captured_at)
    ).all()
    now = datetime.utcnow()
    recent_bookings = s.scalar(
        select(func.count(Booking.id)).where(
            Booking.parking_id == parking.id,
            Booking.status.in_(["BOOKED", "ACTIVE"]),
            Booking.created_at >= now - timedelta(hours=24),
        )
    ) or 0

    if len(logs) >= 2:
        first = logs[0]
        latest = logs[-1]
        elapsed_hours = max(
            (latest.captured_at - first.captured_at).total_seconds()
            / 3600,
            1 / 60,
        )
        occupancy_slope = (
            latest.occupied_slots - first.occupied_slots
        ) / elapsed_hours
        source = "historical_trend_estimate"
        message = "Forecast based on recorded occupancy history."

        def projected_available(hours: float):
            return parking.total_slots - min(
                parking.total_slots,
                max(0, latest.occupied_slots + occupancy_slope * hours),
            )
    else:
        booking_rate = recent_bookings / 24
        source = "data_driven_fallback"
        message = (
            "AI model history is limited; forecast uses current slot state "
            "and recorded active booking demand."
        )

        def projected_available(hours: float):
            return max(
                0,
                current_available - booking_rate * hours,
            )

    def forecast(hours: float):
        expected_slots = int(round(
            max(0, min(current_available, projected_available(hours)))
        ))
        return {
            "availability_probability": round(
                expected_slots / parking.total_slots,
                4,
            ) if parking.total_slots else 0,
            "predicted_available_slots": expected_slots,
        }

    response = {
        "parking_id": parking.id,
        "current_available": current_available,
        "total_capacity": parking.total_slots,
        "current_occupancy": round(
            current_occupied / parking.total_slots * 100, 2
        ) if parking.total_slots else 0,
        "predictions": {
            "15_minutes": forecast(0.25),
            "30_minutes": forecast(0.5),
            "1_hour": forecast(1),
            "2_hours": forecast(2),
        },
        "prediction_source": source,
        "model_status": source,
        "message": message,
        "generated_at": datetime.utcnow().isoformat(),
    }

    arrival_time = datetime.utcnow() + timedelta(minutes=30)
    ml_prediction = _predict_with_ml(s, parking, arrival_time)
    response["arrival_prediction"] = {
        "arrival_time": arrival_time.isoformat(),
        "predicted_occupancy_percent": ml_prediction["predicted_occupancy_percent"],
        "predicted_available_slots": ml_prediction["predicted_available_slots"],
        "probability_of_parking": ml_prediction["probability_of_parking"],
        "confidence": ml_prediction["confidence"],
        "model_status": ml_prediction["model_status"],
        "evaluation": ml_prediction["evaluation"],
    }
    return response


@app.get("/api/forecast/{facility_id}")
def facility_forecast(
    facility_id: int,
    arrival_time: str | None = Query(None),
    s: Session = Depends(db),
):
    parking = s.get(ParkingArea, facility_id)
    if not parking:
        raise HTTPException(status_code=404, detail="Parking area not found")

    try:
        parsed_arrival = datetime.fromisoformat(arrival_time) if arrival_time else datetime.utcnow() + timedelta(minutes=30)
    except ValueError:
        raise HTTPException(status_code=400, detail="arrival_time must be an ISO 8601 datetime string")

    base_prediction = _predict_with_ml(s, parking, parsed_arrival)
    base_prediction["parking_id"] = parking.id
    base_prediction["facility_name"] = parking.name
    base_prediction["total_capacity"] = parking.total_slots
    base_prediction["data_timestamp"] = datetime.utcnow().isoformat()
    return base_prediction


@app.post("/api/route-and-parking")
def route_and_parking(
    request: RouteAndParkingRequest,
    s: Session = Depends(db),
):
    origin = request.origin
    destination = request.destination

    straight_distance_km = haversine_distance(
        origin.lat,
        origin.lon,
        destination.lat,
        destination.lon,
    )
    drive_minutes = max(5.0, (straight_distance_km / 28.0) * 60.0)
    arrival_time = datetime.utcnow() + timedelta(minutes=max(0, request.arrival_minutes))

    candidate_rows = []
    for area in s.scalars(select(ParkingArea)).all():
        if not (math.isfinite(area.latitude) and math.isfinite(area.longitude)):
            continue
        distance_to_destination = haversine_distance(
            area.latitude,
            area.longitude,
            destination.lat,
            destination.lon,
        )
        distance_to_origin = haversine_distance(
            area.latitude,
            area.longitude,
            origin.lat,
            origin.lon,
        )
        if distance_to_destination > request.radius_km and distance_to_origin > request.radius_km:
            continue

        availability = live_slot_counts(s, area.id) or (0, 0)
        current_available = max(0, availability[0])
        total_capacity = max(1, area.total_slots)
        occupancy_percent = round((total_capacity - current_available) / total_capacity * 100, 2)
        prediction = _predict_with_ml(s, area, arrival_time)
        probability = float(prediction["probability_of_parking"])
        composite_score = (
            probability * 0.5
            + (max(0, current_available) / total_capacity) * 0.25
            + max(0.0, 1.0 - (distance_to_destination / max(request.radius_km, 1.0))) * 0.25
        )

        candidate_rows.append({
            "id": area.id,
            "name": area.name,
            "address": area.address,
            "latitude": area.latitude,
            "longitude": area.longitude,
            "distance_from_destination_km": round(distance_to_destination, 3),
            "distance_from_origin_km": round(distance_to_origin, 3),
            "estimated_drive_minutes": round(max(3.0, distance_to_destination / 28.0 * 60.0), 1),
            "current_available_slots": current_available,
            "total_capacity": total_capacity,
            "current_occupancy_percent": occupancy_percent,
            "predicted_occupancy_percent": prediction["predicted_occupancy_percent"],
            "predicted_available_slots": prediction["predicted_available_slots"],
            "parking_probability": probability,
            "confidence": prediction["confidence"],
            "model_status": prediction["model_status"],
            "generated_at": prediction["generated_at"],
            "recommendation_score": round(composite_score, 4),
        })

    candidate_rows.sort(
        key=lambda item: (-item["recommendation_score"], item["distance_from_destination_km"])
    )

    route = {
        "origin": {"lat": origin.lat, "lon": origin.lon},
        "destination": {"lat": destination.lat, "lon": destination.lon},
        "distance_km": round(straight_distance_km, 3),
        "estimated_duration_minutes": round(drive_minutes, 1),
        "estimated_arrival": (datetime.utcnow() + timedelta(minutes=max(0, request.arrival_minutes))).isoformat(),
        "source": "geodesic_estimate",
        "note": "Using live geodesic distance and live parking data; no external routing provider is configured in this deployment.",
    }

    recommendations = candidate_rows[:8]
    return {
        "route": route,
        "parking_recommendations": recommendations,
        "generated_at": datetime.utcnow().isoformat(),
        "data_timestamp": datetime.utcnow().isoformat(),
        "prediction_horizon_minutes": max(0, request.arrival_minutes),
        "total_candidates": len(recommendations),
    }


@app.get(
    "/api/predictions/occupancy"
)
def prediction(

    parking_area_id: int,

    hours_ahead: int = 1,

    s: Session = Depends(db),

):

    result = parking_prediction(parking_area_id, s)
    if hours_ahead <= 1:
        selected = result["predictions"]["1_hour"]
    else:
        selected = result["predictions"]["2_hours"]
    predicted_occupancy = round(
        100 - selected["availability_probability"] * 100,
        2,
    )


    return {

        "parking_area_id": parking_area_id,
        "hours_ahead": hours_ahead,
        "predicted_occupancy_percent": predicted_occupancy,
        "confidence": result["prediction_source"],
        "model_status": result["model_status"],
        "recommendation": result["message"],
        "note": "Values are derived from live slots, occupancy history, and active booking demand.",

    }


# =========================================================
# ADMIN: ML MODEL STATS
# =========================================================

@app.get("/api/admin/ml-stats")
def admin_ml_stats(
    s: Session = Depends(db),
    _: User = Depends(admin),
):
    """Return diagnostics about the LinearRegression ML model used for
    occupancy predictions.  Requires admin authentication."""

    # Count how many distinct parking facilities have at least one log entry
    facilities_with_logs: int = s.scalar(
        select(func.count(func.distinct(OccupancyLog.parking_area_id)))
    ) or 0

    # Total number of OccupancyLog rows in the database
    total_occupancy_logs: int = (
        s.scalar(select(func.count(OccupancyLog.id))) or 0
    )

    # ISO timestamp of the most-recent log entry (None if table is empty)
    most_recent_log = s.scalar(
        select(func.max(OccupancyLog.captured_at))
    )
    data_freshness: str | None = (
        most_recent_log.isoformat()
        if most_recent_log is not None
        else None
    )

    # Consider the model "active" when at least some logs exist and sklearn
    # is available; otherwise label it "limited_data".
    model_status = (
        "active"
        if (LinearRegression is not None and total_occupancy_logs > 0)
        else "limited_data"
    )

    return {
        "model_type": "LinearRegression",
        "features_used": [
            "hour_of_day",
            "day_of_week",
            "occupancy_ratio",
            "recent_average",
            "recent_bookings",
            "total_capacity",
        ],
        "facilities_with_logs": facilities_with_logs,
        "total_occupancy_logs": total_occupancy_logs,
        "data_freshness": data_freshness,
        "model_status": model_status,
        "training_notes": (
            "Model trained per-request on facility historical data"
        ),
        "sklearn_available": LinearRegression is not None,
        "numpy_available": np is not None,
    }


# =========================================================
# ASSISTANT QUERY  (public endpoint)
# =========================================================

class AssistantContext(BaseModel):
    location: str | None = None
    destination: str | None = None
    facility_id: int | None = None


class AssistantQuery(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    context: AssistantContext = AssistantContext()


def _detect_intent(query: str) -> str:
    """Simple keyword-based intent classifier."""
    q = query.lower()
    if any(w in q for w in ["find parking", "where to park", "park near", "parking near"]):
        return "find_parking"
    if any(w in q for w in ["available", "availability", "free slot", "open slot", "any slot"]):
        return "check_availability"
    if any(w in q for w in ["predict", "prediction", "forecast", "how busy", "will there be"]):
        return "get_prediction"
    if any(w in q for w in ["route", "direction", "navigate", "how to get"]):
        return "get_route"
    if any(w in q for w in ["my booking", "my reservation", "show booking", "booking list"]):
        return "get_bookings"
    if any(w in q for w in ["best parking", "recommended", "top parking", "suggest"]):
        return "best_facility"
    return "general"


@app.post("/api/assistant/query")
def assistant_query(
    body: AssistantQuery,
    s: Session = Depends(db),
):
    """Natural-language assistant endpoint backed by real database data.

    Parses the ``query`` string, identifies the user's intent, fetches live
    data from the database, and returns a structured JSON response.  This
    endpoint is intentionally public (no auth required) so the assistant
    widget can be used by unauthenticated visitors.
    """

    intent = _detect_intent(body.query)
    context = body.context

    # ------------------------------------------------------------------
    # INTENT: find_parking
    # Return the top-5 facilities ordered by available slots (descending)
    # ------------------------------------------------------------------
    if intent == "find_parking":
        areas = s.scalars(select(ParkingArea)).all()
        ranked = []
        for area in areas:
            counts = live_slot_counts(s, area.id)
            avail = counts[0] if counts else max(0, area.total_slots - area.occupied_slots)
            ranked.append((avail, area))
        ranked.sort(key=lambda item: -item[0])
        top5 = [
            {
                "id": a.id,
                "name": a.name,
                "address": a.address,
                "available_slots": avail,
                "total_slots": a.total_slots,
                "latitude": a.latitude,
                "longitude": a.longitude,
            }
            for avail, a in ranked[:5]
        ]
        response_text = (
            f"Here are the top {len(top5)} parking facilities with the most available slots right now."
            if top5
            else "No parking facilities found in the system yet."
        )
        return {
            "intent": intent,
            "response_text": response_text,
            "data": {"facilities": top5},
            "action": {"type": "navigate", "path": "/parking"},
            "confidence": "high",
        }

    # ------------------------------------------------------------------
    # INTENT: best_facility
    # Return the single facility with the most available slots + its ML
    # prediction for the next 30 minutes.
    # ------------------------------------------------------------------
    if intent == "best_facility":
        areas = s.scalars(select(ParkingArea)).all()
        best_area = None
        best_avail = -1
        for area in areas:
            counts = live_slot_counts(s, area.id)
            avail = counts[0] if counts else max(0, area.total_slots - area.occupied_slots)
            if avail > best_avail:
                best_avail = avail
                best_area = area

        if best_area is None:
            return {
                "intent": intent,
                "response_text": "No parking facilities are available right now.",
                "data": {},
                "action": None,
                "confidence": "high",
            }

        arrival_30m = datetime.utcnow() + timedelta(minutes=30)
        prediction = _predict_with_ml(s, best_area, arrival_30m)
        facility_data = {
            "id": best_area.id,
            "name": best_area.name,
            "address": best_area.address,
            "available_slots": best_avail,
            "total_slots": best_area.total_slots,
            "latitude": best_area.latitude,
            "longitude": best_area.longitude,
            "prediction_30min": {
                "predicted_available_slots": prediction["predicted_available_slots"],
                "predicted_occupancy_percent": prediction["predicted_occupancy_percent"],
                "confidence": prediction["confidence"],
                "model_status": prediction["model_status"],
            },
        }
        return {
            "intent": intent,
            "response_text": (
                f"The best option right now is **{best_area.name}** with "
                f"{best_avail} available slots out of {best_area.total_slots}."
            ),
            "data": {"facility": facility_data},
            "action": {"type": "navigate", "path": f"/parking/{best_area.id}"},
            "confidence": "high",
        }

    # ------------------------------------------------------------------
    # INTENT: check_availability
    # Report current availability for a specific facility (from context)
    # or for all facilities if no context is provided.
    # ------------------------------------------------------------------
    if intent == "check_availability":
        if context.facility_id:
            parking = s.get(ParkingArea, context.facility_id)
            if not parking:
                return {
                    "intent": intent,
                    "response_text": "I couldn't find that parking facility.",
                    "data": {},
                    "action": None,
                    "confidence": "high",
                }
            counts = live_slot_counts(s, parking.id)
            avail = counts[0] if counts else max(0, parking.total_slots - parking.occupied_slots)
            occupied = parking.total_slots - avail
            pct = round(occupied / parking.total_slots * 100, 1) if parking.total_slots else 0
            return {
                "intent": intent,
                "response_text": (
                    f"{parking.name} currently has {avail} slots available "
                    f"({pct}% occupied)."
                ),
                "data": {
                    "facility": {
                        "id": parking.id,
                        "name": parking.name,
                        "available_slots": avail,
                        "total_slots": parking.total_slots,
                        "occupancy_percent": pct,
                    }
                },
                "action": None,
                "confidence": "high",
            }
        # No specific facility — return overview totals
        total_avail = s.scalar(
            select(func.count(ParkingSlot.id)).where(ParkingSlot.status == "AVAILABLE")
        ) or 0
        total_slots = s.scalar(select(func.count(ParkingSlot.id))) or 0
        occ_pct = round((total_slots - total_avail) / total_slots * 100, 1) if total_slots else 0
        return {
            "intent": intent,
            "response_text": (
                f"Across all facilities there are currently {total_avail} "
                f"available slots out of {total_slots} total ({occ_pct}% occupied)."
            ),
            "data": {
                "total_available": total_avail,
                "total_capacity": total_slots,
                "occupancy_percent": occ_pct,
            },
            "action": None,
            "confidence": "high",
        }

    # ------------------------------------------------------------------
    # INTENT: get_prediction
    # Run ML prediction for the facility in context (or first facility).
    # ------------------------------------------------------------------
    if intent == "get_prediction":
        if context.facility_id:
            parking = s.get(ParkingArea, context.facility_id)
        else:
            parking = s.scalar(select(ParkingArea).order_by(ParkingArea.id))

        if not parking:
            return {
                "intent": intent,
                "response_text": "No parking facilities are available to forecast.",
                "data": {},
                "action": None,
                "confidence": "low",
            }

        arrival_time = datetime.utcnow() + timedelta(minutes=30)
        prediction = _predict_with_ml(s, parking, arrival_time)
        return {
            "intent": intent,
            "response_text": (
                f"In ~30 minutes, **{parking.name}** is predicted to have "
                f"{prediction['predicted_available_slots']} available slots "
                f"({prediction['predicted_occupancy_percent']:.1f}% occupancy). "
                f"Confidence: {prediction['confidence']}."
            ),
            "data": {
                "facility_id": parking.id,
                "facility_name": parking.name,
                "prediction": prediction,
            },
            "action": None,
            "confidence": prediction["confidence"].lower() if prediction.get("confidence") else "medium",
        }

    # ------------------------------------------------------------------
    # INTENT: get_route
    # ------------------------------------------------------------------
    if intent == "get_route":
        return {
            "intent": intent,
            "response_text": (
                "Use the Route & Parking feature to plan your journey. "
                "Enter your origin and destination and I will recommend the "
                "best parking facilities along your route."
            ),
            "data": {},
            "action": {"type": "navigate", "path": "/route"},
            "confidence": "high",
        }

    # ------------------------------------------------------------------
    # INTENT: get_bookings
    # ------------------------------------------------------------------
    if intent == "get_bookings":
        return {
            "intent": intent,
            "response_text": (
                "Navigate to the Bookings section to view, manage, or "
                "cancel your active reservations."
            ),
            "data": {},
            "action": {"type": "navigate", "path": "/bookings"},
            "confidence": "high",
        }

    # ------------------------------------------------------------------
    # INTENT: general  (fallback)
    # ------------------------------------------------------------------
    total_facilities = s.scalar(select(func.count(ParkingArea.id))) or 0
    total_avail_gen = s.scalar(
        select(func.count(ParkingSlot.id)).where(ParkingSlot.status == "AVAILABLE")
    ) or 0
    return {
        "intent": "general",
        "response_text": (
            f"Welcome to VELTRIX Smart Parking! We manage {total_facilities} parking "
            f"facilities in Mumbai with {total_avail_gen} slots available right now. "
            "You can ask me to find parking, check availability, predict occupancy, "
            "or show your bookings."
        ),
        "data": {
            "total_facilities": total_facilities,
            "available_slots": total_avail_gen,
        },
        "action": None,
        "confidence": "high",
    }
