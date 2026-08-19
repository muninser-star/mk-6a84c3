#!/bin/bash
# Обновить опубликованную Медкнижку. Запускать из любого места.
set -e
BASE="/Users/d.opalinskiy/Documents/Трансформация/Личное/Здоровье"
cd "$BASE/Публикация"
cp "$BASE/Медкнижка.html" index.html
git add -A
git commit -m "Медкнижка: обновление $(date +%d.%m.%Y)" || { echo "Изменений нет."; exit 0; }
git push
echo "Готово. Обновится на сайте через 1-2 минуты."
