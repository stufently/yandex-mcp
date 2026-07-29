/**
 * Правила окон у Wordstat v2 (Yandex Cloud Search API) нигде не описаны, а нарушение
 * каждого из них API отбивает сырым gRPC-текстом. Проверено на боевом API 2026-07-29:
 *
 *   daily    from старше 60 дней → "The from field value is older than 60 days"
 *                                  (-60d отбивается, -59d проходит)
 *   weekly   from обязан быть понедельником, to — воскресеньем
 *   monthly  from обязан быть первым числом месяца, to — последним
 *
 * Здесь даты приводятся к ближайшему валидному окну (и мы говорим, что подвинули),
 * вместо того чтобы отдать пользователю сырую ошибку gRPC.
 *
 * Всё считается в UTC: смешивание локального времени и toISOString() давало сдвиг
 * на сутки для пользователей восточнее Гринвича.
 */

const DAY_MS = 86_400_000;

/** Самая старая `from`, которую принимает daily. */
export const DAILY_MAX_AGE_DAYS = 59;
/** Дефолт берём на день ближе к границе — чтобы запрос не протух на смене суток UTC. */
export const DAILY_DEFAULT_AGE_DAYS = 58;

export function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/** 'YYYY-MM-DD' → полночь UTC. Всё остальное — ошибка с понятным текстом. */
export function parseDate(value, label = 'date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) {
    throw new Error(`Invalid ${label} "${value}": expected YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${label} "${value}": not a real calendar date.`);
  if (formatDate(date) !== value) throw new Error(`Invalid ${label} "${value}": not a real calendar date.`);
  return date;
}

function startOfUTCDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Понедельник этой же недели (или сам день, если он понедельник). */
function toMonday(date) {
  return addDays(date, -((date.getUTCDay() + 6) % 7));
}

function firstOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function lastOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/** Последнее воскресенье, которое уже наступило и закрыло свою неделю. */
function lastClosedSunday(today) {
  return addDays(today, -(today.getUTCDay() === 0 ? 7 : today.getUTCDay()));
}

/** Последний день последнего ЗАКРЫТОГО месяца. */
function lastClosedMonthEnd(today) {
  return lastOfMonth(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
}

/** Окно по умолчанию — самое свежее, которое API гарантированно отдаёт. */
export function getDefaultDates(period, now = new Date()) {
  const today = startOfUTCDay(now);

  if (period === 'daily') {
    return {
      fromDate: formatDate(addDays(today, -DAILY_DEFAULT_AGE_DAYS)),
      toDate: formatDate(addDays(today, -1)),
    };
  }

  if (period === 'weekly') {
    // Строго прошедшее воскресенье: текущая неделя ещё не закрыта.
    const to = addDays(today, -(today.getUTCDay() === 0 ? 7 : today.getUTCDay()));
    return { fromDate: formatDate(addDays(toMonday(to), -51 * 7)), toDate: formatDate(to) };
  }

  // Последний ЗАКРЫТЫЙ месяц и 12 месяцев назад от него (ровно 12 точек, не 13).
  const to = lastOfMonth(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  return { fromDate: formatDate(from), toDate: formatDate(to) };
}

/**
 * Приводит пару дат к валидному для периода окну.
 * @returns {{fromDate: string, toDate: string, adjustments: string[]}}
 */
export function alignDates(period, fromDate, toDate, now = new Date()) {
  const defaults = getDefaultDates(period, now);
  const adjustments = [];

  const rawFrom = fromDate ?? defaults.fromDate;
  const rawTo = toDate ?? defaults.toDate;
  let from = parseDate(rawFrom, 'fromDate');
  let to = parseDate(rawTo, 'toDate');

  if (from > to) {
    throw new Error(`Empty date range: fromDate ${formatDate(from)} is after toDate ${formatDate(to)}.`);
  }

  const today = startOfUTCDay(now);
  const note = (what, before, after) => {
    if (formatDate(before) !== formatDate(after)) {
      adjustments.push(`${what} ${formatDate(before)} → ${formatDate(after)}`);
    }
  };

  if (period === 'weekly' || period === 'monthly') {
    const weekly = period === 'weekly';
    // Незакрытый период API не принимает (`toDate` в текущей неделе/месяце → 400),
    // поэтому верхнюю границу и подтягиваем к границе периода, и прижимаем к последнему
    // ЗАКРЫТОМУ. Нижнюю — просто к началу периода.
    const startOfPeriod = weekly ? toMonday : firstOfMonth;
    const endOfPeriod = weekly ? (d) => addDays(toMonday(d), 6) : lastOfMonth;
    const lastClosed = weekly ? lastClosedSunday(today) : lastClosedMonthEnd(today);
    const label = weekly ? 'week' : 'month';

    const snappedFrom = startOfPeriod(from);
    note(weekly ? 'fromDate snapped to Monday:' : 'fromDate snapped to start of month:', from, snappedFrom);
    from = snappedFrom;

    // Верхнюю границу тянем ВПЕРЁД, к концу её же периода: округление назад выбрасывало
    // целую закрытую неделю, о которой пользователь и спрашивал (to=пятница → предыдущее
    // воскресенье). А уже потом прижимаем к последнему закрытому периоду — незакрытый
    // API не принимает (400).
    let snappedTo = endOfPeriod(to);
    if (snappedTo > lastClosed) snappedTo = lastClosed;
    note(weekly ? 'toDate snapped to Sunday:' : 'toDate snapped to end of month:', to, snappedTo);
    to = snappedTo;

    if (to < from) {
      throw new Error(
        `The ${label} starting ${formatDate(from)} has not finished yet — Wordstat only returns whole ${label}s. ` +
          `Latest available toDate is ${formatDate(lastClosed)}.`,
      );
    }
  } else if (period === 'daily') {
    const floor = addDays(today, -DAILY_MAX_AGE_DAYS);
    if (from < floor) {
      adjustments.push(
        `fromDate ${formatDate(from)} → ${formatDate(floor)} (daily history is limited to the last ${DAILY_MAX_AGE_DAYS} days)`,
      );
      from = floor;
    }
    // Будущую дату API проглатывает молча, отдавая меньше точек, чем просили, —
    // лучше сказать вслух, чем оставить необъяснимый пробел в хвосте.
    if (to > today) {
      adjustments.push(`toDate ${formatDate(to)} → ${formatDate(today)} (no data beyond today)`);
      to = today;
    }
    if (from > to) {
      throw new Error(
        `Empty date range: toDate ${formatDate(to)} is older than the ${DAILY_MAX_AGE_DAYS}-day daily window.`,
      );
    }
  }

  return { fromDate: formatDate(from), toDate: formatDate(to), adjustments };
}
