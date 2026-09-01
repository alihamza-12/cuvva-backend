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

module.exports = { LONDON_TIME_ZONE, policyDateTimeToInstant };
