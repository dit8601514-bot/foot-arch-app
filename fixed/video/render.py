import json, subprocess, os, sys
P = json.load(open('/tmp/vid/frames/plan.json'))
X = 0.35   # 상태 사이 교차
F = 0.4    # 장면 시작/끝 페이드
ENC = ['-c:v','libx264','-crf','18','-preset','veryfast','-pix_fmt','yuv420p','-r','30']
only = sys.argv[1].split(',') if len(sys.argv) > 1 else None
for sc in P:
    name, st = sc['scene'], sc['states']
    if only and name not in only: continue
    total = sum(d for _, d in st)
    inputs, filt = [], []
    for i, (k, d) in enumerate(st):
        segd = d + (X if i < len(st) - 1 else 0)
        inputs += ['-framerate','30','-i',f'/tmp/vid/frames/{name}_{k}.jpg']
        filt.append(f'[{i}:v]format=yuv420p,loop=-1:1,trim=duration={segd:.3f},setpts=PTS-STARTPTS,fps=30[v{i}]')
    cur, acc = 'v0', 0.0
    for i in range(1, len(st)):
        acc += st[i-1][1]
        out = f'x{i}'
        filt.append(f'[{cur}][v{i}]xfade=transition=fade:duration={X}:offset={acc:.3f}[{out}]'); cur = out
    filt.append(f'[{cur}]fade=t=in:st=0:d={F},fade=t=out:st={total-F:.3f}:d={F},trim=duration={total:.3f}[o]')
    tmp = f'/tmp/vid/out/{name}.tmp.mp4'
    cmd = ['ffmpeg','-v','error','-y'] + inputs + ['-filter_complex',';'.join(filt),'-map','[o]'] + ENC + [tmp]
    r = subprocess.run(cmd)
    if r.returncode == 0: os.replace(tmp, f'/tmp/vid/out/{name}.mp4'); print('ok', name, total)
    else: print('FAIL', name); sys.exit(1)
