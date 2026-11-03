from PIL import Image, ImageDraw, ImageFilter, ImageFont
import random, math, json
DPI=300; S=DPI/2.54          # px per cm
W,H=int(29.7*S),int(21.0*S)  # A4 가로
outline=[[0,1.4],[0.25,3.6],[1.0,6.6],[2.2,9.6],[2.8,12.5],[8.6,12.5],[9.6,9.4],[12.5,7.0],[16.0,5.0],[19.5,3.7],[22.5,2.8],[24.6,2.0],[25.3,1.1],[25.0,0.25],[22.5,0],[18.0,0],[15.6,0.45],[12.5,1.15],[9.5,1.1],[7.2,0.4],[5.8,0],[2.0,0],[0.5,0.35]]
X0=2.2; FLOOR=16.2           # 발뒤꿈치 x(cm), 바닥선 y(cm, 위에서)
px=lambda x,y:((X0+x)*S,(FLOOR-y)*S)
FONT='/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'
import os
if not os.path.exists(FONT):
    import glob; c=glob.glob('/usr/share/fonts/**/*CJK*',recursive=True)+glob.glob('/usr/share/fonts/**/*Nanum*',recursive=True); FONT=c[0] if c else None
def font(sz,bold=False):
    try: return ImageFont.truetype(FONT.replace('Regular','Bold') if bold and 'Regular' in FONT else FONT, sz)
    except Exception: return ImageFont.truetype(FONT, sz)
def sheet(p2h, title, sub, out, seed, flat=0.0, grow=0.0):
    random.seed(seed)
    # 체중부하 시 유연성 평발: 아치 아랫면이 바닥 쪽으로 내려오고, 발등이 조금 낮아지며, 발이 조금 길어진다
    def adj(x, y):
        nx = x + (grow * min(1, (x - 4) / 14.5) if x > 4 else 0)
        if 6.5 < x < 16.5 and y < 1.5: y = y * (1 - 0.85 * flat)
        elif 9.6 <= x <= 19.5 and y > 3: y = y - 0.5 * flat
        return [nx, y]
    ol = [adj(x, y) for x, y in outline]
    im=Image.new('RGB',(W,H),(236,234,229)); d=ImageDraw.Draw(im)
    # 바닥(밝은 회갈색 장판)
    d.rectangle([0,FLOOR*S,W,H],fill=(168,160,150))
    for i in range(0,W,int(4*S)): d.line([(i,FLOOR*S),(i-int(2*S),H)],fill=(160,152,142),width=3)
    # 다리(발목 위로 이어짐) + 발
    leg=[px(2.8,12.5),px(2.6,30),px(8.9,30),px(8.6,12.5)]
    skin=(222,170,138)
    mask=Image.new('L',(W,H),0); md=ImageDraw.Draw(mask)
    md.polygon([px(x,y) for x,y in ol],fill=255); md.polygon(leg,fill=255)
    mask=mask.filter(ImageFilter.GaussianBlur(1.2))
    # 피부 음영: 위쪽은 조금 밝고 발바닥 쪽은 조금 어둡게
    sk=Image.new('RGB',(W,H)); sd=ImageDraw.Draw(sk)
    for y in range(H):
        t=min(1,max(0,(y/S-3)/(FLOOR-3)))
        c=tuple(int(skin[k]*(1.04-0.12*t)) for k in range(3)); sd.line([(0,y),(W,y)],fill=c)
    im.paste(sk,(0,0),mask)
    # 그림자(바닥 접촉부)
    sh=Image.new('L',(W,H),0); ImageDraw.Draw(sh).ellipse([px(0.3,0)[0],FLOOR*S-4,px(25.0,0)[0],FLOOR*S+0.35*S],fill=90)
    sh=sh.filter(ImageFilter.GaussianBlur(6)); im.paste((120,112,104),(0,0),sh)
    im.paste(sk,(0,0),mask)  # 그림자가 발 위에 겹치지 않게
    d=ImageDraw.Draw(im)
    # 복사뼈 표시(옅게)
    mx,my=px(6.2,7.2); r=0.9*S; d.ellipse([mx-r,my-r,mx+r,my+r],outline=(205,152,122),width=4)
    # 스티커: 지름 16 mm 파란 원
    R=0.8*S; pts={'P3':(4.0,2.0),'P2':(10.6,p2h),'P1':(18.5+grow,2.0)}
    for k,(x,y) in pts.items():
        cx,cy=px(x,y); d.ellipse([cx-R,cy-R,cx+R,cy+R],fill=(28,92,214))
    # 안내 문구·축척 막대(오른쪽 위 벽면)
    tx=int(13.2*S); ty=int(1.0*S)
    d.text((tx,ty),title,fill=(40,40,40),font=font(78,True))
    d.text((tx,ty+int(1.0*S)),sub,fill=(70,70,70),font=font(46))
    lines=['유연성 평발 예시 · 왼발 안쪽 · 발가락 오른쪽 · 스티커 지름 16 mm','P1·P3: 바닥 위 20 mm   P2: 바닥 위 %d mm'%round(p2h*10),'100% 크기로 인쇄(용지에 맞춤 끄기) — 아래 막대가 100 mm인지 자로 확인']
    for i,l in enumerate(lines): d.text((tx,ty+int((1.9+0.62*i)*S)),l,fill=(80,80,80),font=font(38))
    by=ty+int(4.0*S); d.rectangle([tx,by,tx+10*S,by+0.25*S],fill=(40,40,40))
    for i in range(11): d.line([(tx+i*S,by-0.25*S),(tx+i*S,by)],fill=(40,40,40),width=4)
    d.text((tx+10*S+20,by-0.35*S),'100 mm',fill=(40,40,40),font=font(38))
    # 아주 약한 잡음(실사 질감)
    n=Image.effect_noise((W//4,H//4),10).resize((W,H)).convert('RGB')
    im=Image.blend(im,Image.composite(n,im,Image.new('L',(W,H),255)),0.04)
    im.save(out+'.png',dpi=(DPI,DPI))
    return im, {k:px(*v) for k,v in pts.items()}
pre,tp=sheet(4.2,'유연성 평발 시트 1 · 앉은 자세(비체중부하)','발배뼈(P2) 높이 42 mm · 아치 정상','flex1_sitting',11)
post,tq=sheet(3.0,'유연성 평발 시트 2 · 선 자세(체중부하)','발배뼈(P2) 높이 30 mm → 정답 하강 12.0 mm','flex2_standing',12,flat=1.0,grow=0.2)
pre.save('AI_Footarch_flexible_flatfoot_sheets.pdf',save_all=True,append_images=[post],resolution=DPI)
for im,n in [(pre,'flex_sitting_1920'),(post,'flex_standing_1920')]:
    im.resize((1920,int(1920*H/W)),Image.LANCZOS).save(n+'.png')
print('ok')
