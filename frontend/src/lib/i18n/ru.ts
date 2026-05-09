export const ru = {
  app: {
    title: 'Z — AI-встречи',
    loading: 'Загрузка...',
    tagline: 'Видеовстречи с AI-отчётом под тип встречи.',
  },
  errors: {
    network: 'Ошибка сети. Проверьте подключение.',
    unauthorized: 'Войдите чтобы продолжить.',
    forbidden: 'Нет прав на это действие.',
    unknown: 'Что-то пошло не так.',
  },
  meetings: {
    create: 'Создать встречу',
    list: 'Мои встречи',
    empty: 'Встреч пока нет.',
  },
  auth: {
    login: 'Войти',
    logout: 'Выйти',
  },
  common: {
    retry: 'Повторить',
    close: 'Закрыть',
    cancel: 'Отмена',
    confirm: 'Подтвердить',
  },
} as const;

export type Dict = typeof ru;
