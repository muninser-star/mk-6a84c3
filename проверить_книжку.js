// Проверка Медкнижки перед публикацией.
// Ловит то, что ломает страницу в браузере, но не видно при чтении файла:
// синтаксис скрипта, разъехавшийся DATA, дубли записей и поля не того типа.
// Запускается из опубликовать.sh. Ненулевой код возврата = публикацию не делаем.
const fs = require("fs");
const path = process.argv[2];
const h = fs.readFileSync(path, "utf8");
const bad = [];
const warn = [];

// 1. Синтаксис всего инлайнового скрипта
const sc = h.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);
if (!sc) bad.push("не найден блок <script>");
else { try { new Function(sc[1]); } catch (e) { bad.push("синтаксис скрипта: " + e.message); } }

// 2. DATA парсится целиком
const dm = h.match(/const DATA = \{[\s\S]*?\n\};/);
if (!dm) bad.push("не найден блок DATA");
let D = null;
if (dm) {
  try { D = eval("(" + dm[0].replace(/^const DATA = /, "").replace(/;$/, "") + ")"); }
  catch (e) { bad.push("DATA не разбирается: " + e.message); }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ru = (iso) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

if (D) for (const k of Object.keys(D)) {
  const p = D[k];

  // 3. Записи: дата, форма full, статус
  const seen = {};
  (p.rec || []).forEach(r => {
    if (!ISO.test(String(r.d))) bad.push(`${k}: дата «${r.d}» у «${r.title}» не в формате ГГГГ-ММ-ДД`);
    if (r.full && !Array.isArray(r.full)) bad.push(`${k}: full не массив у «${r.title}»`);
    (r.full || []).forEach((x, i) => {
      if (!Array.isArray(x) || x.length < 2 || typeof x[0] !== "string" || typeof x[1] !== "string")
        bad.push(`${k}: «${r.title}» full[${i}] не пара строк`);
    });
    if (r.st && !["ok", "warn", "bad", "none", ""].includes(r.st))
      bad.push(`${k}: «${r.title}» st="${r.st}" — неизвестный статус`);
    const key = r.d + "|" + (r.title || "");
    seen[key] = (seen[key] || 0) + 1;
  });
  Object.entries(seen).filter(([, v]) => v > 1)
    .forEach(([key, v]) => bad.push(`${k}: запись продублирована ${v} раза — ${key}`));

  // 4. Препараты. plan и from/to рисуются через ru(), который делает iso.split("-").
  //    Любое не-ISO значение здесь роняет весь render() и страница человека белеет.
  (p.meds || []).forEach(x => {
    ["from", "to"].forEach(f => {
      if (x[f] && !ISO.test(String(x[f]))) bad.push(`${k}: «${x.n}» ${f}="${x[f]}" — нужна дата ГГГГ-ММ-ДД`);
    });
    if (x.plan && !ISO.test(String(x.plan)) && x.plan !== 1 && x.plan !== true)
      bad.push(`${k}: «${x.n}» plan=${JSON.stringify(x.plan)} — нужна дата ГГГГ-ММ-ДД либо 1`);
    if (x.plan && (x.from || x.to))
      warn.push(`${k}: «${x.n}» помечен запланированным, но у него есть from/to — курс посчитается идущим`);
  });

  // 5. Списки дел
  (p.soon || []).forEach(x => {
    if (typeof x.what !== "string" || typeof x.when !== "string")
      bad.push(`${k}: кривая запись в soon — ${JSON.stringify(x).slice(0, 80)}`);
    if (/^✅|состоял|пройден[оа]?$|сделан/i.test(x.what || ""))
      warn.push(`${k}: в «ближайших» стоит уже сделанное — «${x.what}». Выполненное убирается из списка дел`);
  });
  (p.attention || []).forEach(a => {
    if (a.facts && !Array.isArray(a.facts)) bad.push(`${k}: facts не массив у «${a.t}»`);
    if (/^✅|состоял|пройден[оа]?$|сделан/i.test(a.t || ""))
      warn.push(`${k}: в «требует внимания» стоит уже сделанное — «${a.t}». Либо убрать, либо переписать в оставшийся шаг`);
  });

  // 6. Сухой прогон той самой строки рендера, что упала на plan:1
  (p.meds || []).forEach(x => {
    try { if (x.plan && ISO.test(String(x.plan))) ru(x.plan); if (x.from) ru(x.from); }
    catch (e) { bad.push(`${k}: «${x.n}» роняет рендер: ${e.message}`); }
  });
}

// 7. Плитка «Принимает» (kpi auto:"meds") собирается из meds функцией страницы medsKpi.
//    Прогоняем именно код страницы, а не его копию: иначе проверка разойдётся с тем, что видит врач.
if (D && sc) {
  const pick = (name) => { const m = sc[1].match(new RegExp("function " + name + "\\([\\s\\S]*?\\n\\}\\n")); return m ? m[0] : null; };
  const ruSrc = (sc[1].match(/const ru=\(iso\)=>\{[^\n]*?\};/) || [])[0];
  const parts = ["medStart", "medActive", "medShort", "medsKpi"].map(pick);
  if (!ruSrc || parts.some(x => !x)) bad.push("не найдены функции плитки «Принимает» (ru, medStart, medActive, medShort, medsKpi)");
  else {
    let medsKpi;
    try { medsKpi = new Function(ruSrc + parts.join("\n") + "; return medsKpi;")(); }
    catch (e) { bad.push("код плитки «Принимает» не собирается: " + e.message); }
    if (medsKpi) for (const k of Object.keys(D)) {
      const p = D[k];
      (p.kpi || []).filter(t => t.auto === "meds").forEach(t => {
        if (!p.meds) { bad.push(`${k}: плитка «${t.lab}» auto:"meds", а таблицы meds нет`); return; }
        const t2 = Object.assign({}, t);
        try { medsKpi(p, t2); } catch (e) { bad.push(`${k}: плитка «${t.lab}» роняет рендер: ${e.message}`); return; }
        if (!t2.val) bad.push(`${k}: плитка «${t.lab}» получилась пустой`);
        console.log(`  плитка ${k}: ${t2.val} — ${t2.sub}`);
      });
      (p.meds || []).forEach(x => {
        if (!x.plan && !x.from && !/\d{2}\.\d{2}\.\d{4}/.test(String(x.how || "")))
          warn.push(`${k}: «${x.n}» без даты старта — в плитку «Принимает» не попадёт как идущий. Поставить from или plan`);
      });
    }
  }
}

if (warn.length) { console.log("СТОИТ ПОСМОТРЕТЬ:"); warn.forEach(w => console.log("  🟡 " + w)); }
if (bad.length) {
  console.log("\nПУБЛИКАЦИЯ ОСТАНОВЛЕНА — " + bad.length + ":");
  bad.forEach(b => console.log("  🔴 " + b));
  process.exit(1);
}
console.log("Проверка книжки: чисто" + (warn.length ? ` (${warn.length} замечаний выше)` : ""));
