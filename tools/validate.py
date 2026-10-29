import json,sys,glob,re
files=sys.argv[1:] or sorted(glob.glob('data/part_*.json'))
CATS="밥·죽 면 국·찌개 고기·구이 반찬 분식 양식 중식 일식 아시안 패스트푸드 빵·디저트 음료 과일·간식".split()
ids={};errs=0;n=0
for f in files:
    try: data=json.load(open(f,encoding='utf-8'))
    except Exception as e: print(f,'JSON 오류',e); errs+=1; continue
    for x in data:
        n+=1; pre=f"{f.split('/')[-1]}:{x.get('id')}"
        def E(m):
            global errs; errs+=1; print(pre,m)
        for k in "id name aliases clip cat serving grams ingredients macro na lose gain alt recipe".split():
            if k not in x: E('필드 누락 '+k)
        if errs and any(k not in x for k in ["id","ingredients","macro","grams"]): continue
        if not re.fullmatch(r'[a-z0-9_]+',x['id']): E('id 형식')
        if x['id'] in ids: E('중복 id (also in '+ids[x['id']]+')')
        ids[x['id']]=f
        if x.get('cat') not in CATS: E('카테고리 '+str(x.get('cat')))
        ing=x['ingredients']; kc=sum(i['kcal'] for i in ing); g=sum(i['g'] for i in ing)
        for i in ing:
            if i.get('t') not in ('main','side','sauce'): E('재료 t '+str(i))
        if x['grams'] and abs(g-x['grams'])>0.15*x['grams']+5: E(f'중량 불일치 재료합 {g} vs {x["grams"]}')
        m=x['macro']; mk=4*m['c']+4*m['p']+9*m['f']
        if kc>0 and abs(mk-kc)>0.15*kc+15: E(f'매크로 kcal {mk} vs 재료합 {kc}')
        if not any(i['t']=='sauce' for i in ing) and x['cat'] not in ('과일·간식','음료'): print(pre,'(경고) 양념 항목 없음')
        tiny = kc < 5  # 물·차처럼 칼로리가 거의 없는 음료는 팁 생략 허용
        if not tiny and not (2<=len(x['lose'])<=4 and all(t['d']<0 for t in x['lose'])): E('lose 개수/부호')
        if not tiny and not (1<=len(x['gain'])<=4 and all(t['d']>0 for t in x['gain'])): E('gain 개수/부호')
        for s in ('lose','gain'):
            if not tiny and not x['alt'].get(s): E('alt.'+s+' 없음')
        r=x['recipe']
        if r is None:
            if kc>=80: E('recipe null은 80kcal 미만 음식만 허용')
            continue
        if not all(k in r for k in ('title','kcal','items','steps')): E('recipe 필드')
        elif r['kcal']>=kc: E(f'recipe kcal {r["kcal"]} >= 원래 {kc}')
print(f'음식 {n}개, 오류 {errs}개'); sys.exit(1 if errs else 0)
