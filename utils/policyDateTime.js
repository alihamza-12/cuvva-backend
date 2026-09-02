const LONDON_TIME_ZONE = "Europe/London";

const getDateParts = (dateValue) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
};

const getZonedParts = (instant) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
};

const policyDateTimeToInstant = (dateValue, timeValue) => {
  const date = getDateParts(dateValue);
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(timeValue || ""));
  if (!date || !match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const desiredUtcShape = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
    0,
    0,
  );
  let instant = new Date(desiredUtcShape);

  // Iteratively remove the London offset. This handles both GMT and BST
  // without depending on the server's local timezone.
  for (let index = 0; index < 3; index += 1) {
    const zoned = getZonedParts(instant);
    const representedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second,
    );
    const offset = representedAsUtc - instant.getTime();
    instant = new Date(desiredUtcShape - offset);
  }

  // Spring-forward times such as 01:30 on the DST transition day do not
  // exist in Europe/London. Reject them rather than silently shifting them.
  const verified = getZonedParts(instant);
  if (
    verified.year !== date.year ||
    verified.month !== date.month ||
    verified.day !== date.day ||
    verified.hour !== hour ||
    verified.minute !== minute
  ) {
    return null;
  }

  return instant;
};

const formatLondonDateTime = (instant) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);

const humanizeDuration = (milliseconds) => {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
};

module.exports = {
  LONDON_TIME_ZONE,
  policyDateTimeToInstant,
  formatLondonDateTime,
  humanizeDuration,
};
