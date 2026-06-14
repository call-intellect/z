/* ============================================================================
   Кора — публичное интерактивное демо кабинета
   Единый движок взаимодействия (Ф0): экраны/роли/тема (перенос из прототипа
   1-в-1) + делегированный data-action диспетчер + оверлей + tab-движок + toast.
   Vanilla JS, без модулей/сборки, работает из file://. Только русский UI.
   Этот же файл подключается и к mobile.html — все обращения к опциональным
   узлам обёрнуты в guard на null.
   ============================================================================ */
window.DEMO = window.DEMO || {};

/* ---------------------------------------------------------------------------
   1) Перенесённое из прототипа поведение: экраны / роли / тема (1-в-1)
   --------------------------------------------------------------------------- */
const TITLES = {
  today:    ['Сегодня', 'Понедельник, 13 июня · ООО «Луа»'],
  week:     ['Неделя', '9–15 июня · понедельничный разбор'],
  month:    ['Итоги месяца', 'Май 2026 · витрина для совета'],
  requires: ['Требует вас', 'Очередь решений · 6 ждут вас'],
  meetings: ['Встречи', '13 встреч · поиск по транскриптам'],
  tasks:    ['Задачи', 'Проекты · спринты · календарь'],
  memory:   ['Память', 'Спросить · лента · реестры'],
  feed:     ['Лента Коры', 'Живая лента памяти · идеи · сигналы · блокеры · вопросы'],
  team:     ['Команда', '4 сотрудника · 4 отдела'],
  me:       ['Я', 'Личный кабинет'],
  settings: ['Настройки', 'Интеграции · справочник · админка'],
};
function go(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + id));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.goto === id));
  const t = TITLES[id];
  const pt = document.getElementById('page-title');
  const ps = document.getElementById('page-sub');
  if (t && pt) { pt.textContent = t[0]; }
  if (t && ps) { ps.textContent = t[1]; }
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-goto]').forEach(el => el.addEventListener('click', () => go(el.dataset.goto)));

function applyRole(role) {
  document.body.dataset.role = role;
  document.querySelectorAll('.role-switch button').forEach(b => b.classList.toggle('active', b.dataset.role === role));
  document.querySelectorAll('[data-role-show]').forEach(el => {
    const roles = el.dataset.roleShow.split(',');
    el.style.display = roles.includes(role) ? '' : 'none';
  });
  // member приземляется на «Я» (= его Сегодня)
  if (role === 'member') go('me'); else go('today');
}
document.querySelectorAll('.role-switch button').forEach(b => b.addEventListener('click', () => applyRole(b.dataset.role)));
if (document.querySelector('.role-switch button')) applyRole('owner');

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  document.querySelectorAll('.theme-switch button').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === theme));
}
document.querySelectorAll('.theme-switch button').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.themeBtn)));
applyTheme('dark');

/* ---------------------------------------------------------------------------
   2) Единый движок: оверлей + toast + tab-движок + делегированный диспетчер
   --------------------------------------------------------------------------- */

/* --- Инъекция служебных узлов (оверлей + тост), если их ещё нет --- */
function ensureChrome() {
  if (!document.getElementById('overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'overlay';
    overlay.className = 'overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="overlay-scrim" data-action="close-overlay"></div>' +
      '<div class="overlay-panel" role="dialog" aria-modal="true">' +
        '<button class="overlay-close" data-action="close-overlay" aria-label="Закрыть">×</button>' +
        '<div class="overlay-body"></div>' +
      '</div>';
    document.body.appendChild(overlay);
  }
  if (!document.getElementById('toast')) {
    const t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    t.hidden = true;
    document.body.appendChild(t);
  }
}
ensureChrome();

/* --- Toast --- */
let _toastTimer = null;
function toast(text) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = text;
  t.hidden = false;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

/* --- Хелперы рендеринга (общие для Ф3–Ф6) --- */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function personById(id) {
  return ((window.DEMO && window.DEMO.people) || []).find(p => p.id === id) || null;
}
function personName(id) {
  const p = personById(id);
  return p ? p.name : id;
}

/* --- Ф3: деталь встречи --- */
function renderMeeting(id) {
  const m = ((window.DEMO && window.DEMO.meetings) || []).find(x => x.id === id);
  if (!m) return '<div class="overlay-stub">Встреча не найдена</div>';

  // Шапка: заголовок + чипы тип/дата
  let html = '';
  html += '<div class="card-title" style="margin-bottom:6px;">' +
            '<span class="card-ico" style="background:var(--grad-violet)">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l4.5-2.5v9L15 14M3 7h12v10H3z"/></svg>' +
            '</span>' +
            '<h3 style="margin:0;">' + esc(m.title) + '</h3>' +
          '</div>';
  html += '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">' +
            '<span class="chip info"><span class="led"></span>' + esc(m.type) + '</span>' +
            (m.date ? '<span class="chip"><span class="led"></span>' + esc(m.date) + '</span>' : '') +
            (m.duration ? '<span class="chip"><span class="led"></span>' + esc(m.duration) + '</span>' : '') +
          '</div>';

  // Участники
  if (Array.isArray(m.participants) && m.participants.length) {
    html += '<div class="section-h" style="margin-bottom:10px;">Участники</div>';
    html += '<div class="row-list" style="margin-bottom:18px;">';
    m.participants.forEach(pid => {
      const p = personById(pid);
      html += '<div class="list-row" style="padding:8px 0; cursor:pointer;" data-action="open-person" data-id="' + esc(pid) + '">' +
                '<div class="body"><div class="ttl" style="font-size:13px;">' + esc(p ? p.name : pid) + '</div>' +
                (p && p.role ? '<div class="meta">' + esc(p.role) + '</div>' : '') +
                '</div></div>';
    });
    html += '</div>';
  }

  // Краткое содержание
  if (m.summary) {
    html += '<div class="section-h" style="margin-bottom:10px;">Краткое содержание</div>';
    html += '<p class="muted" style="font-size:13.5px; line-height:1.6; margin:0 0 18px;">' + esc(m.summary) + '</p>';
  }

  // Транскрипт-таймлайн
  if (Array.isArray(m.transcript) && m.transcript.length) {
    html += '<div class="section-h" style="margin-bottom:10px;">Транскрипт</div>';
    html += '<div class="row-list" style="margin-bottom:18px;">';
    m.transcript.forEach(line => {
      html += '<div class="tr-row">' +
                '<span class="tr-time">' + esc(line.t) + '</span>' +
                '<div class="tr-body">' +
                  '<div class="tr-who">' + esc(line.who) + '</div>' +
                  '<div class="tr-text">' + esc(line.text) + '</div>' +
                '</div>' +
              '</div>';
    });
    html += '</div>';
  }

  // AI-отчёт (обобщённо по ключам объекта report)
  if (m.report && typeof m.report === 'object') {
    const keys = Object.keys(m.report);
    if (keys.length) {
      html += '<div class="section-h" style="margin-bottom:10px;">AI-отчёт</div>';
      html += '<div style="margin-bottom:18px;">';
      keys.forEach(k => {
        const val = m.report[k];
        html += '<div class="report-sec">';
        html += '<div class="report-sec-h">' + esc(k) + '</div>';
        if (Array.isArray(val)) {
          html += '<ul class="report-list">';
          val.forEach(item => { html += '<li>' + esc(item) + '</li>'; });
          html += '</ul>';
        } else {
          html += '<div class="report-sec-body">' + esc(val) + '</div>';
        }
        html += '</div>';
      });
      html += '</div>';
    }
  }

  // Извлечённые задачи
  const allTasks = (window.DEMO && window.DEMO.tasks) || [];
  if (Array.isArray(m.tasks) && m.tasks.length) {
    html += '<div class="section-h" style="margin-bottom:10px;">Извлечённые задачи</div>';
    html += '<div class="row-list" style="margin-bottom:18px;">';
    m.tasks.forEach(tid => {
      const t = allTasks.find(x => x.id === tid);
      html += '<div class="list-row" style="padding:9px 0; cursor:pointer;" data-action="open-task" data-id="' + esc(tid) + '">' +
                '<div class="body"><div class="ttl" style="font-size:13px;">' + esc(t ? t.title : tid) + '</div>' +
                (t && t.assignee ? '<div class="meta">' + esc(personName(t.assignee)) + (t.due ? ' · ' + esc(t.due) : '') + '</div>' : '') +
                '</div>' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--dim); flex:none;"><path d="M9 6l6 6-6 6"/></svg>' +
              '</div>';
    });
    html += '</div>';
  }

  // Извлечённые решения
  const allDecisions = ((window.DEMO && window.DEMO.decisions) || []).concat((window.DEMO && window.DEMO.decisionsArchive) || []);
  if (Array.isArray(m.decisions) && m.decisions.length) {
    html += '<div class="section-h" style="margin-bottom:10px;">Извлечённые решения</div>';
    html += '<div class="row-list" style="margin-bottom:4px;">';
    m.decisions.forEach(did => {
      const d = allDecisions.find(x => x.id === did);
      html += '<div class="list-row" style="padding:9px 0; cursor:pointer;" data-action="open-decision" data-id="' + esc(did) + '">' +
                '<div class="body"><div class="ttl" style="font-size:13px;">' + esc(d ? d.title : did) + '</div>' +
                (d && d.status ? '<div class="meta">' + esc(d.status) + '</div>' : '') +
                '</div>' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--dim); flex:none;"><path d="M9 6l6 6-6 6"/></svg>' +
              '</div>';
    });
    html += '</div>';
  }

  return html;
}

/* --- Ф4: деталь задачи --- */
const TASK_STATUS_LABELS = {
  backlog:  'Бэклог',
  progress: 'В работе',
  review:   'На проверке',
  done:     'Готово',
};
function renderTask(id) {
  const t = ((window.DEMO && window.DEMO.tasks) || []).find(x => x.id === id);
  if (!t) return '<div class="overlay-stub">Задача не найдена</div>';

  // Шапка: заголовок
  let html = '';
  html += '<div class="card-title" style="margin-bottom:6px;">' +
            '<span class="card-ico" style="background:var(--grad-teal)">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3 8-8"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' +
            '</span>' +
            '<h3 style="margin:0;">' + esc(t.title) + '</h3>' +
          '</div>';

  // Чипы: статус / проект / срок
  html += '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">' +
            '<span class="chip info"><span class="led"></span>' + esc(TASK_STATUS_LABELS[t.status] || t.status) + '</span>' +
            (t.project ? '<span class="chip"><span class="led"></span>' + esc(t.project) + '</span>' : '') +
            (t.due ? '<span class="chip warn"><span class="led"></span>срок: ' + esc(t.due) + '</span>' : '') +
          '</div>';

  // Исполнитель
  const p = personById(t.assignee);
  if (p || t.assignee) {
    html += '<div class="section-h" style="margin-bottom:10px;">Исполнитель</div>';
    html += '<div class="row-list" style="margin-bottom:18px;">' +
              '<div class="list-row" style="padding:8px 0; cursor:pointer;" data-action="open-person" data-id="' + esc(t.assignee) + '">' +
                '<div class="body"><div class="ttl" style="font-size:13px;">' + esc(p ? p.name : t.assignee) + '</div>' +
                (p && p.role ? '<div class="meta">' + esc(p.role) + '</div>' : '') +
                '</div>' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--dim); flex:none;"><path d="M9 6l6 6-6 6"/></svg>' +
              '</div>' +
            '</div>';
  }

  // Источник — встреча
  const meeting = ((window.DEMO && window.DEMO.meetings) || []).find(x => x.id === t.sourceMeeting);
  if (t.sourceMeeting) {
    html += '<div class="section-h" style="margin-bottom:10px;">Источник</div>';
    html += '<div class="row-list" style="margin-bottom:18px;">' +
              '<div class="list-row" style="padding:9px 0; cursor:pointer;" data-action="open-meeting" data-id="' + esc(t.sourceMeeting) + '">' +
                '<div class="body"><div class="ttl" style="font-size:13px;">' + esc(meeting ? meeting.title : t.sourceMeeting) + '</div>' +
                (meeting && meeting.date ? '<div class="meta">' + esc(meeting.date) + (meeting.type ? ' · ' + esc(meeting.type) : '') + '</div>' : '') +
                '</div>' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--dim); flex:none;"><path d="M9 6l6 6-6 6"/></svg>' +
              '</div>' +
            '</div>';
  }

  // История
  if (Array.isArray(t.history) && t.history.length) {
    html += '<div class="section-h" style="margin-bottom:10px;">История</div>';
    html += '<div class="row-list" style="margin-bottom:18px;">';
    t.history.forEach(h => {
      html += '<div class="tr-row">' +
                '<span class="tr-time">' + esc(h.when) + '</span>' +
                '<div class="tr-body"><div class="tr-text">' + esc(h.what) + '</div></div>' +
              '</div>';
    });
    html += '</div>';
  }

  // Комментарии (если есть)
  if (Array.isArray(t.comments) && t.comments.length) {
    html += '<div class="section-h" style="margin-bottom:10px;">Комментарии</div>';
    html += '<div class="row-list" style="margin-bottom:18px;">';
    t.comments.forEach(c => {
      html += '<div class="list-row" style="padding:8px 0;">' +
                '<div class="body"><div class="meta">' + esc(personName(c.who)) + '</div>' +
                '<div class="ttl" style="font-size:13px; font-weight:400;">' + esc(c.text) + '</div></div>' +
              '</div>';
    });
    html += '</div>';
  }

  // Mock-смена статуса
  html += '<div class="section-h" style="margin-bottom:10px;">Сменить статус</div>';
  html += '<div style="display:flex; gap:8px; flex-wrap:wrap;">';
  ['backlog', 'progress', 'review', 'done'].forEach(st => {
    const cls = (st === t.status) ? 'btn primary' : 'btn';
    html += '<button class="' + cls + '" data-action="task-status" data-id="' + esc(t.id) + '" data-status="' + esc(TASK_STATUS_LABELS[st]) + '">' + esc(TASK_STATUS_LABELS[st]) + '</button>';
  });
  html += '</div>';

  return html;
}

/* --- Ф4: деталь решения из очереди «Требует вас» --- */
const DECISION_KIND_LABELS = { goal: 'цель', decision: 'решение', conflict: 'конфликт' };
const DECISION_KIND_CHIP = { goal: 'warn', decision: 'info', conflict: 'risk' };
function renderDecision(id) {
  const all = ((window.DEMO && window.DEMO.decisions) || []).concat((window.DEMO && window.DEMO.decisionsArchive) || []);
  const d = all.find(x => x.id === id);
  if (!d) return '<div class="overlay-stub">Решение не найдено</div>';

  let html = '';
  // Чип типа
  const chipCls = DECISION_KIND_CHIP[d.kind] || 'info';
  html += '<div style="margin-bottom:12px;">' +
            '<span class="chip ' + chipCls + '"><span class="led"></span>' + esc(DECISION_KIND_LABELS[d.kind] || d.kind) + '</span>' +
          '</div>';

  // Заголовок
  html += '<div class="card-title" style="margin-bottom:14px;">' +
            '<span class="card-ico" style="background:var(--grad-amber)">' +
              '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l-6-6 6-6M15 6l6 6-6 6"/></svg>' +
            '</span>' +
            '<h3 style="margin:0;">' + esc(d.title) + '</h3>' +
          '</div>';

  // Доп. чипы приоритет / ожидание
  const metaChips = [];
  if (d.priority) metaChips.push('<span class="chip warn"><span class="led"></span>' + esc(d.priority) + ' приоритет</span>');
  if (d.waiting) metaChips.push('<span class="chip" style="color:var(--faint); background:var(--surface-soft)">' + esc(d.waiting) + '</span>');
  if (d.status) metaChips.push('<span class="chip ok"><span class="led"></span>' + esc(d.status) + '</span>');
  if (metaChips.length) {
    html += '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">' + metaChips.join('') + '</div>';
  }

  // Подробность
  if (d.detail) {
    html += '<p class="muted" style="font-size:13.5px; line-height:1.6; margin:0 0 18px;">' + esc(d.detail) + '</p>';
  }

  // Источник — встреча
  const meeting = ((window.DEMO && window.DEMO.meetings) || []).find(x => x.id === d.sourceMeeting);
  if (d.sourceMeeting) {
    html += '<div class="section-h" style="margin-bottom:10px;">Источник</div>';
    html += '<div class="row-list" style="margin-bottom:18px;">' +
              '<div class="list-row" style="padding:9px 0; cursor:pointer;" data-action="open-meeting" data-id="' + esc(d.sourceMeeting) + '">' +
                '<div class="body"><div class="ttl" style="font-size:13px;">' + esc(meeting ? meeting.title : d.sourceMeeting) + '</div>' +
                (meeting && meeting.date ? '<div class="meta">' + esc(meeting.date) + (meeting.type ? ' · ' + esc(meeting.type) : '') + '</div>' : '') +
                '</div>' +
                '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--dim); flex:none;"><path d="M9 6l6 6-6 6"/></svg>' +
              '</div>' +
            '</div>';
  }

  // Действия владельца (mock)
  html += '<div class="section-h" style="margin-bottom:10px;">Ваше решение</div>';
  html += '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
            '<button class="btn ok" data-action="decision-accept" data-id="' + esc(d.id) + '">Принять</button>' +
            '<button class="btn" data-action="decision-return" data-id="' + esc(d.id) + '">Вернуть на доработку</button>' +
            '<button class="btn ghost" data-action="decision-postpone" data-id="' + esc(d.id) + '">Отложить</button>' +
          '</div>';

  return html;
}

/* --- Ф4: mock-действие над решением очереди (без перезагрузки) --- */
function decisionAction(id, kind) {
  const labels = { accept: 'Решение принято', return: 'Возвращено на доработку', postpone: 'Отложено' };
  // убрать все элементы очереди с этим решением из DOM
  document.querySelectorAll('[data-decision-item="' + id + '"]').forEach(el => el.remove());
  // уменьшить счётчики очереди
  document.querySelectorAll('[data-decision-count]').forEach(c => {
    const n = parseInt(c.textContent, 10);
    if (!isNaN(n) && n > 0) c.textContent = String(n - 1);
  });
  toast(labels[kind] || 'Готово');
  closeOverlay();
}

/* --- Рендереры деталей (заглушки Ф0; реальные шаблоны добавят Ф3–Ф6) --- */
const RENDERERS = {
  meeting:  renderMeeting,
  task:     renderTask,
  decision: renderDecision,
  person:   (id) => `<div class="overlay-stub">Профиль (${id}) — заполняется в Ф5</div>`,
};

/* --- Оверлей --- */
function openOverlay(type, id) {
  const overlay = document.getElementById('overlay');
  if (!overlay) return;
  const body = overlay.querySelector('.overlay-body');
  const renderer = RENDERERS[type];
  if (body) body.innerHTML = renderer ? renderer(id) : '';
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeOverlay() {
  const overlay = document.getElementById('overlay');
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = '';
  const body = overlay.querySelector('.overlay-body');
  if (body) body.innerHTML = '';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeOverlay();
});

/* --- Tab-движок: переключение вкладок в пределах data-group --- */
function activateTab(el) {
  const group = el.dataset.group;
  const tab = el.dataset.tab;
  if (!group) return;
  document.querySelectorAll('[data-group="' + group + '"]').forEach(b => {
    b.classList.toggle('active', b === el);
  });
  const panels = document.querySelectorAll('[data-tabpanel^="' + group + ':"]');
  panels.forEach(p => {
    p.hidden = (p.getAttribute('data-tabpanel') !== group + ':' + tab);
  });
}

/* --- Generic-фильтр: реальная фильтрация карточек по data-* (Ф2b) --- */
function applyFilter(el) {
  const grp = el.dataset.filterGroup, key = el.dataset.filterKey;
  if (!grp || !key) return;
  // переключить active среди кнопок той же группы+ключа
  document.querySelectorAll('[data-action="filter"][data-filter-group="' + grp + '"][data-filter-key="' + key + '"]').forEach(b => {
    b.classList.toggle('active', b === el);
  });
  // собрать активные фильтры группы (по каждому ключу)
  const active = {};
  document.querySelectorAll('[data-action="filter"][data-filter-group="' + grp + '"].active').forEach(b => {
    active[b.dataset.filterKey] = b.dataset.filterVal;
  });
  // карточка видна, если совпадает по ВСЕМ активным ключам (val 'all' = не фильтрует)
  document.querySelectorAll('[data-filter-card="' + grp + '"]').forEach(card => {
    let show = true;
    for (const k in active) {
      const v = active[k];
      if (v !== 'all' && card.dataset[k] !== v) { show = false; break; }
    }
    card.hidden = !show;
  });
}

/* --- Делегированный диспетчер: один слушатель на document --- */
const ACTIONS = {
  'tab': activateTab,
  'filter': applyFilter,
  'open-meeting': el => openOverlay('meeting', el.dataset.id),
  'open-task': el => openOverlay('task', el.dataset.id),
  'open-person': el => openOverlay('person', el.dataset.id),
  'open-decision': el => openOverlay('decision', el.dataset.id),
  'task-status': el => toast('Статус задачи обновлён: ' + el.dataset.status),
  'decision-accept': el => decisionAction(el.dataset.id, 'accept'),
  'decision-return': el => decisionAction(el.dataset.id, 'return'),
  'decision-postpone': el => decisionAction(el.dataset.id, 'postpone'),
  'close-overlay': closeOverlay,
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const handler = ACTIONS[el.dataset.action];
  if (handler) { e.preventDefault(); handler(el); }
});
