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
    mo = sc.get('motion')
    if mo:  # 정지(before초) → 동작 프레임(30fps) → 상태 a 이어서
        inputs += ['-framerate','30','-i',f'/tmp/vid/frames/{name}_m_000.jpg','-framerate','30','-start_number','1','-i',f'/tmp/vid/frames/{name}_m_%03d.jpg']
        filt.append(f"[0:v]format=yuv420p,loop=-1:1,trim=duration={mo['before']:.3f},setpts=PTS-STARTPTS,fps=30[m0]")
        filt.append(f"[1:v]format=yuv420p,trim=end_frame={mo['n']},setpts=PTS-STARTPTS,fps=30[m1]")
        mlen = mo['before'] + mo['n'] / 30
    base = len(inputs) // 4
    for i, (k, d) in enumerate(st):
        segd = d + (X if i < len(st) - 1 else 0) - (mlen if (mo and i == 0) else 0)
        inputs += ['-framerate','30','-i',f'/tmp/vid/frames/{name}_{k}.jpg']
        filt.append(f'[{base + i}:v]format=yuv420p,loop=-1:1,trim=duration={segd:.3f},setpts=PTS-STARTPTS,fps=30,settb=1/30[v{i}]')
        if mo and i == 0:
            filt.append('[m0][m1][v0]concat=n=3:v=1:a=0,settb=1/30,fps=30[v0c]')
    cur, acc = ('v0c' if mo else 'v0'), 0.0
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
