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

/* --- Рендереры деталей (заглушки Ф0; реальные шаблоны добавят Ф3–Ф6) --- */
const RENDERERS = {
  meeting:  (id) => `<div class="overlay-stub">Деталь встречи (${id}) — заполняется в Ф3</div>`,
  task:     (id) => `<div class="overlay-stub">Деталь задачи (${id}) — заполняется в Ф4</div>`,
  decision: (id) => `<div class="overlay-stub">Деталь решения (${id}) — заполняется в Ф4</div>`,
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

/* --- Делегированный диспетчер: один слушатель на document --- */
const ACTIONS = {
  'tab': activateTab,
  'open-meeting': el => openOverlay('meeting', el.dataset.id),
  'open-task': el => openOverlay('task', el.dataset.id),
  'open-person': el => openOverlay('person', el.dataset.id),
  'open-decision': el => openOverlay('decision', el.dataset.id),
  'close-overlay': closeOverlay,
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const handler = ACTIONS[el.dataset.action];
  if (handler) { e.preventDefault(); handler(el); }
});
