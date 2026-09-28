from datetime import datetime
from hashlib import pbkdf2_hmac
from pathlib import Path
from secrets import token_hex
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

class Base(DeclarativeBase): pass
ROOT = Path(__file__).resolve().parent.parent
engine = create_engine(f"sqlite:///{ROOT / 'veltrix.db'}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False)
class User(Base):
    __tablename__='users'; id: Mapped[int]=mapped_column(primary_key=True); name: Mapped[str]=mapped_column(String(100)); email: Mapped[str]=mapped_column(String(255),unique=True,index=True); password_hash: Mapped[str]=mapped_column(String(255)); role: Mapped[str]=mapped_column(String(20),default='driver'); created_at: Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
class ParkingArea(Base):
    __tablename__='parking_areas'; id: Mapped[int]=mapped_column(primary_key=True); code: Mapped[str]=mapped_column(String(20),unique=True); name: Mapped[str]=mapped_column(String(120)); address: Mapped[str]=mapped_column(String(255)); latitude: Mapped[float]=mapped_column(Float); longitude: Mapped[float]=mapped_column(Float); total_slots: Mapped[int]=mapped_column(Integer); occupied_slots: Mapped[int]=mapped_column(Integer,default=0)
class ParkingSlot(Base):
    __tablename__='parking_slots'; id: Mapped[int]=mapped_column(primary_key=True); parking_area_id: Mapped[int]=mapped_column(ForeignKey('parking_areas.id'),index=True); slot_number: Mapped[str]=mapped_column(String(20)); status: Mapped[str]=mapped_column(String(20),default='available')
class OccupancyLog(Base):
    __tablename__='occupancy_logs'; id: Mapped[int]=mapped_column(primary_key=True); parking_area_id: Mapped[int]=mapped_column(ForeignKey('parking_areas.id'),index=True); occupied_slots: Mapped[int]=mapped_column(Integer); captured_at: Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow,index=True); source: Mapped[str]=mapped_column(String(50),default='admin')
class Signup(BaseModel): name:str=Field(min_length=2,max_length=100);email:EmailStr;password:str=Field(min_length=6,max_length=128)
class Login(BaseModel): email:EmailStr;password:str
class Update(BaseModel): occupied_slots:int=Field(ge=0);source:str='admin'
app=FastAPI(title='VELTRIX API',version='1.0.0');app.add_middleware(CORSMiddleware,allow_origins=['http://localhost:5173'],allow_credentials=True,allow_methods=['*'],allow_headers=['*']);tokens={}
def db():
    s=SessionLocal()
    try: yield s
    finally: s.close()
def h(p): return pbkdf2_hmac('sha256',p.encode(),b'veltrix-student-demo-v1',260000).hex()
def out(a):
    pct=round(a.occupied_slots/a.total_slots*100);return {'id':a.id,'code':a.code,'name':a.name,'address':a.address,'latitude':a.latitude,'longitude':a.longitude,'total_slots':a.total_slots,'occupied_slots':a.occupied_slots,'available_slots':a.total_slots-a.occupied_slots,'occupancy_percent':pct,'distance_km':{1:.35,2:.7,3:1.2}.get(a.id,1.5),'status':'Almost full' if pct>90 else 'Moderate' if pct>75 else 'Available'}
def user(authorization:str|None=Header(None),s:Session=Depends(db)):
    t=authorization.removeprefix('Bearer ').strip() if authorization else '';u=s.get(User,tokens.get(t)) if t else None
    if not u: raise HTTPException(401,'Authentication required')
    return u
def admin(u:User=Depends(user)):
    if u.role!='admin':raise HTTPException(403,'Admin access required')
    return u
@app.on_event('startup')
def seed():
    Base.metadata.create_all(engine);s=SessionLocal()
    if not s.scalar(select(User.id).limit(1)):
        s.add(User(name='VELTRIX Administrator',email='admin@veltrixparking.com',password_hash=h('admin123'),role='admin'))
        for code,name,address,lat,lng,total,occupied in [('A-01','Andheri Smart Parking','Western Express Highway',19.1197,72.8468,100,68),('B-02','Metro Parking Hub','Andheri Metro Station',19.1202,72.8461,80,68),('C-03','City Center Parking','Lokhandwala Junction',19.1314,72.8294,60,57)]:
            a=ParkingArea(code=code,name=name,address=address,latitude=lat,longitude=lng,total_slots=total,occupied_slots=occupied);s.add(a);s.flush();s.add_all([ParkingSlot(parking_area_id=a.id,slot_number=f'{code}-{i+1:03}',status='occupied' if i<occupied else 'available') for i in range(total)]);s.add(OccupancyLog(parking_area_id=a.id,occupied_slots=occupied,source='seed'))
        s.commit()
    s.close()
@app.get('/health')
def health():return {'status':'online','database':'sqlite','ml_model':'demo heuristic — not trained'}
@app.post('/api/auth/signup')
def signup(x:Signup,s:Session=Depends(db)):
    if s.scalar(select(User).where(User.email==x.email)):raise HTTPException(409,'An account with this email already exists')
    u=User(name=x.name,email=x.email,password_hash=h(x.password));s.add(u);s.commit();s.refresh(u);t=token_hex(24);tokens[t]=u.id;return {'token':t,'user':{'id':u.id,'name':u.name,'email':u.email,'role':u.role}}
@app.post('/api/auth/login')
def login(x:Login,s:Session=Depends(db)):
    u=s.scalar(select(User).where(User.email==x.email))
    if not u or u.password_hash!=h(x.password):raise HTTPException(401,'Invalid email or password')
    t=token_hex(24);tokens[t]=u.id;return {'token':t,'user':{'id':u.id,'name':u.name,'email':u.email,'role':u.role}}
@app.get('/api/auth/me')
def me(u:User=Depends(user)):return {'id':u.id,'name':u.name,'email':u.email,'role':u.role}
@app.get('/api/parking-areas')
def areas(s:Session=Depends(db)):return [out(a) for a in s.scalars(select(ParkingArea).order_by(ParkingArea.id))]
@app.get('/api/parking-areas/{area_id}')
def area(area_id:int,s:Session=Depends(db)):
    a=s.get(ParkingArea,area_id)
    if not a:raise HTTPException(404,'Parking area not found')
    return out(a)
@app.patch('/api/parking-areas/{area_id}/occupancy')
def occupancy(area_id:int,x:Update,s:Session=Depends(db),_:User=Depends(admin)):
    a=s.get(ParkingArea,area_id)
    if not a:raise HTTPException(404,'Parking area not found')
    if x.occupied_slots>a.total_slots:raise HTTPException(422,'Occupied slots cannot exceed capacity')
    a.occupied_slots=x.occupied_slots;s.add(OccupancyLog(parking_area_id=a.id,occupied_slots=x.occupied_slots,source=x.source));s.commit();s.refresh(a);return out(a)
@app.get('/api/predictions/occupancy')
def prediction(parking_area_id:int,hours_ahead:int=1,s:Session=Depends(db)):
    a=s.get(ParkingArea,parking_area_id)
    if not a:raise HTTPException(404,'Parking area not found')
    bonus=8 if 17<=datetime.now().hour<=21 else 2;value=min(100,round(a.occupied_slots/a.total_slots*100)+bonus*hours_ahead)
    return {'parking_area_id':a.id,'hours_ahead':hours_ahead,'predicted_occupancy_percent':value,'confidence':'demo','model_status':'demo','recommendation':f'{a.name} is currently selected. Compare availability and distance before driving.','note':'Demo heuristic only; replace with a trained model after collecting historical occupancy logs.'}
