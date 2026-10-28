import json,glob,os
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
foods=[]
for f in sorted(glob.glob('data/part_*.json')): foods+=json.load(open(f,encoding='utf-8'))
open('foods.js','w',encoding='utf-8').write('// 자동 생성: tools/build.py — data/part_*.json 병합\nwindow.FOODS='+json.dumps(foods,ensure_ascii=False,separators=(',',':'))+';\n')
print(len(foods),'foods', os.path.getsize('foods.js')//1024,'KB')
