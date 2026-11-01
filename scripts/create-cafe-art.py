"""Author the eight independent local SVG backgrounds for the last-light story.
No external assets, remote requests, generated character art or private media.
"""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[1]/'apps/web/public/assets/cafe-story'
root.mkdir(parents=True,exist_ok=True)
def rect(x,y,w,h,fill,extra=''):return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" {extra}/>'
def text(x,y,s,size=36,fill='#decbaa'):return f'<text x="{x}" y="{y}" fill="{fill}" font-size="{size}" font-family="Georgia, Noto Serif CJK SC, serif">{s}</text>'
def lamp(x,y):return f'<ellipse cx="{x}" cy="{y+180}" rx="320" ry="410" fill="url(#glow)"/><path d="M{x} 0V{y}" stroke="#1a2628" stroke-width="9"/><path d="M{x-75} {y+90}L{x-38} {y}H{x+38}L{x+75} {y+90}Z" fill="#ad8c55"/><ellipse cx="{x}" cy="{y+90}" rx="75" ry="10" fill="#ffe0a0"/>'
def window(x,y,w,h):
 out=rect(x-18,y-18,w+36,h+36,'#182a31')+rect(x,y,w,h,'url(#sky)')
 for i in range(8):
  bx=x+i*w/8;bh=100+(i*77)%240
  out+=rect(bx,y+h-bh,w/8-12,bh,'#203842')
  for k in range(3):out+=rect(bx+14,y+h-bh+20+k*55,12,17,'#bd9867', 'opacity=".5"')
 out+=rect(x+w*.49,y,16,h,'#3b3830')+rect(x,y+h*.5,w,13,'#3b3830')
 return out

def floor():
 out='<path d="M0 900H2560V1440H0Z" fill="url(#floor)"/>'
 for x in range(-2000,5000,240):out+=f'<path d="M1280 840L{x} 1440" stroke="#c3a277" opacity=".13" stroke-width="3"/>'
 for y in [1000,1120,1260,1420]:out+=f'<path d="M0 {y}H2560" stroke="#171f20" opacity=".24" stroke-width="3"/>'
 return out

def table(x=1280,y=1130):return f'<ellipse cx="{x}" cy="{y+110}" rx="680" ry="90" fill="#111d23" opacity=".6"/><path d="M{x-570} {y}H{x+570}L{x+810} 1440H{x-810}Z" fill="url(#wood)"/><path d="M{x-570} {y}H{x+570}" stroke="#d6b187" stroke-width="12"/>'
def facade(x,y,w,h):
 return rect(x,y,w,h,'#343738')+rect(x+30,y+170,w-60,h-170,'#645342')+rect(x+20,y+30,w-40,120,'#233d3c')+text(x+100,y+115,'雨 停 之 前',64)+rect(x+65,y+235,w*.29,h-250,'#223635')+window(x+w*.43,y+235,w*.5,h-300)+rect(x+82,y+250,w*.25,h-285,'#d0b183','opacity=".12"')
scenes={}
scenes['street-wide']=(
 rect(0,0,2560,1440,'url(#sky)')+rect(0,170,740,850,'#202f38')+rect(1920,60,640,990,'#23323a')+
 ''.join(rect(x,y,55,90,'#aa9871','opacity=".3"') for x in [90,240,430,2050,2230,2420] for y in [240,480,710])+
 facade(660,270,1280,850)+rect(0,1110,2560,330,'#182b35')+
 '<path d="M0 1380L2560 1190M0 1440L2560 1265" stroke="#a5b3aa" opacity=".17" stroke-width="35"/>'+
 ''.join(f'<path d="M{x} 1250L{x-140} 1440H{x+5}L{x+130} 1250Z" fill="#b9c6b8" opacity=".17"/>' for x in range(200,2200,300))+
 '<ellipse cx="1300" cy="1200" rx="510" ry="65" fill="#b99b65" opacity=".18"/>'+text(130,160,'雨夜 · 街角',34))
scenes['cafe-front']=(rect(0,0,2560,1440,'#303b3e')+facade(120,80,2320,1240)+
 '<path d="M80 280H2480L2440 340H120Z" fill="#50685c"/>'+rect(300,410,530,830,'#263b3d')+window(330,450,470,720)+
 rect(755,790,12,110,'#d9b982')+rect(400,720,300,160,'#bdaf8c')+text(450,816,'营业中',50,'#354846')+
 rect(0,1320,2560,120,'#182b32')+text(1460,1260,'LAST NIGHT IN THIS PLACE',26))
scenes['lobby']=(rect(0,0,2560,1000,'url(#wall)')+floor()+window(90,190,570,650)+
 rect(860,180,400,740,'#223532')+rect(893,210,332,710,'#1c292b')+text(932,310,'GALLERY',25)+
 rect(1580,480,850,440,'url(#wood)')+rect(1540,470,930,38,'#d0ba93')+
 ''.join(rect(x,610,230,245,'#a3845e')+f'<path d="M{x} 690H{x+230}M{x+115} 610V855" stroke="#665642" stroke-width="7"/>' for x in [1380,1650])+
 '<path d="M400 1050h350v45H400Zm0 45v250m350-250v250M460 930h250v110H460Z" fill="#456058"/>'+
 lamp(1270,210)+text(1510,390,'这一晚之后，我们搬去新的地方。',32))
scenes['window-seat']=(rect(0,0,2560,1440,'url(#wall)')+window(380,100,1760,910)+
 rect(320,1020,1880,45,'#b49365')+rect(0,1150,720,290,'#334c45')+
 '<path d="M95 1000H620V1220H95Z" fill="#49675a"/>'+table(1330,1170)+lamp(280,240)+lamp(2310,180)+
 '<ellipse cx="1070" cy="1250" rx="95" ry="24" fill="#e0d1ae"/><path d="M1010 1175h120l-15 65q-45 20-90 0Z" fill="#e6d8bb"/><ellipse cx="1070" cy="1175" rx="60" ry="11" fill="#584537"/>'+text(1740,1150,'有些空位，留给重逢。',29))
scenes['photo-corridor']=(rect(0,0,2560,1440,'#3d453e')+floor()+
 '<path d="M0 0L1740 240V970L0 1440Z" fill="#5a5142"/><path d="M2560 0L1740 240V970L2560 1440Z" fill="#333e39"/>'+
 rect(1600,270,300,720,'#263c3a')+text(1640,400,'WASH',33)+
 rect(180,160,480,590,'#98876c')+rect(210,190,420,530,'#253f41')+text(270,340,'同一片海',58)+text(270,430,'旅行摄影联展',32)+text(270,590,'米拉 × 阿岚',38)+
 rect(850,270,330,420,'#a5997e','opacity=".25"')+rect(1260,340,200,280,'#b8ac8e','opacity=".2"')+lamp(1300,100)+
 text(160,1040,'取下相框之后，墙上还留着旧日的形状。',29))
scenes['washroom']=(rect(0,0,2560,1440,'#48534d')+
 ''.join(f'<path d="M0 {y}H2560" stroke="#869086" opacity=".2" stroke-width="3"/>' for y in range(0,1440,140))+
 ''.join(f'<path d="M{x} 0V1440" stroke="#869086" opacity=".16" stroke-width="3"/>' for x in range(0,2560,200))+
 rect(400,160,1450,730,'#a99776')+rect(428,188,1394,674,'url(#mirror)')+
 '<path d="M520 810L1700 260" stroke="#d9d6b6" opacity=".12" stroke-width="95"/>'+
 rect(290,960,1700,150,'#c2b99e')+rect(350,1110,1580,330,'#3c5049')+
 '<ellipse cx="1190" cy="1010" rx="350" ry="100" fill="#e0d7bb"/><ellipse cx="1190" cy="1000" rx="270" ry="60" fill="#8d9b90"/><path d="M1170 960V820q0-100 110-100h70v30h-70q-70 0-70 70v140Z" fill="#bac5b7"/>'+
 rect(1980,100,450,1340,'#263b38')+rect(2020,180,370,1260,'#1b2d2c')+text(510,320,'让雨留在门外。',38,'#b5c2b7')+lamp(260,130))
scenes['counter']=(rect(0,0,2560,1440,'url(#wall)')+floor()+
 rect(120,190,1420,80,'#302f29')+rect(120,440,1420,70,'#302f29')+
 ''.join(rect(x,290,90,130,'#a6b6a4')+rect(x+10,275,70,20,'#d5b785') for x in [220,430,640,850,1060,1270])+
 window(1720,180,650,680)+rect(180,800,2200,640,'url(#wood)')+rect(140,780,2280,58,'#d5c49b')+
 '<path d="M490 520H870L920 780H450Z" fill="#253c3d"/><path d="M520 550H840V700H520Z" fill="#789387"/>'+text(560,640,'LAST LIGHT',28,'#dbe4cb')+
 rect(1550,900,570,160,'#62543e','rx="22"')+text(1600,990,'写给 米拉',44)+lamp(1220,170)+text(400,1190,'有些话，终于留在了这里。',32))
scenes['street-walk']=(rect(0,0,2560,1440,'url(#sky)')+
 '<path d="M0 80L1020 320V960L0 1280Z" fill="#2d3d3e"/><path d="M2560 80L1460 460V940L2560 1440Z" fill="#243640"/>'+
 '<path d="M0 1280L1230 800L2560 1440H0Z" fill="#1b303a"/>'+facade(50,340,850,650)+
 '<path d="M2020 1300V320q0-110-100-110h-200" stroke="#15262c" stroke-width="22" fill="none"/><ellipse cx="1750" cy="225" rx="110" ry="25" fill="#f3d18b"/><ellipse cx="1770" cy="900" rx="410" ry="550" fill="url(#glow)"/>'+
 '<path d="M1230 850L1650 1440M1190 850L1410 1440" stroke="#ccd2b9" opacity=".2" stroke-width="12"/>'+
 ''.join(f'<path d="M{x} {1120+i*34}h{220+i*50}" stroke="#d9b879" opacity=".12" stroke-width="12"/>' for i,x in enumerate([200,120,50,10,600]))+text(150,160,'下一站，由你们决定。',38))
defs='''<defs>
 <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#122c3b"/><stop offset="1" stop-color="#647d7d"/></linearGradient>
 <linearGradient id="wall" x2="1" y2="1"><stop stop-color="#675c46"/><stop offset="1" stop-color="#353d37"/></linearGradient>
 <linearGradient id="wood" x2="0" y2="1"><stop stop-color="#ab8659"/><stop offset="1" stop-color="#5b4937"/></linearGradient>
 <linearGradient id="floor" x2="0" y2="1"><stop stop-color="#625d48"/><stop offset="1" stop-color="#263b39"/></linearGradient>
 <linearGradient id="mirror" x2="1" y2="1"><stop stop-color="#506b68"/><stop offset="1" stop-color="#a9b7a4"/></linearGradient>
 <radialGradient id="glow"><stop stop-color="#ffd696" stop-opacity=".25"/><stop offset="1" stop-color="#ffd696" stop-opacity="0"/></radialGradient>
 <pattern id="grain" width="38" height="37" patternUnits="userSpaceOnUse"><circle cx="4" cy="7" r="1" fill="#f3e6c4"/><circle cx="25" cy="29" r=".7" fill="#101e29"/></pattern>
 </defs>'''
for name,body in scenes.items():
 (root/f'{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 2560 1440"><title>{name} · 雨停之前</title>{defs}{body}<rect width="2560" height="1440" fill="url(#grain)" opacity=".16"/></svg>')
for source,target in [('cafe-front','cafe-front-closed'),('street-wide','street-wide-closed'),('street-walk','street-walk-closed')]:
 content=(root/f'{source}.svg').read_text().replace('营业中','已打烊').replace('#bdaf8c','#5a6255').replace('#d0b183','#3b4c4c').replace('#decbaa','#8c9986').replace('stop-opacity=".25"','stop-opacity=".04"')
 (root/f'{target}.svg').write_text(content)
files={p.name:{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(root.glob('*.svg'))}
(root/'SOURCES.json').write_text(json.dumps({'author':'Project-authored SVG artwork; Codex assisted implementation','license':'Project source license; no external images','baseBackgrounds':list(scenes),'variants':['cafe-front-closed','street-wide-closed','street-walk-closed'],'generator':'scripts/create-cafe-art.py','files':files},ensure_ascii=False,indent=2)+'\n')
