#!/bin/bash
# Обновить опубликованную Медкнижку. Запускать из любого места.
set -e
BASE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BASE/Публикация"
cp "$BASE/Медкнижка.html" index.html
# штампуем версию, чтобы было видно, какую сборку открыл браузер
STAMP="$(date +%d.%m' '%H:%M)"
python3 - "$STAMP" <<'PY'
import io,sys,re
p="index.html"; s=io.open(p,encoding="utf-8").read()
s=re.sub(r'const BUILD="[^"]*";', 'const BUILD="%s";' % sys.argv[1], s, count=1)
io.open(p,"w",encoding="utf-8").write(s)
PY
git add -A
git commit -m "Медкнижка: обновление $(date +%d.%m.%Y)" || { echo "Изменений нет."; exit 0; }
git push
echo "Готово. Обновится на сайте через 1-2 минуты."
