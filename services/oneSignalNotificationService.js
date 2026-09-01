const axios = require("axios");

const ONESIGNAL_ENDPOINT = "https://api.onesignal.com/notifications";

const getConfig = () => {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    throw new Error("OneSignal backend environment variables are not configured.");
  }
  return { appId, apiKey };
};

const getPublicOrigin = () =>
  String(
    process.env.PUBLIC_APP_URL ||
      process.env.CORS_ORIGIN ||
      "https://cuvvapolicies.com",
  ).replace(/\/$/, "");

const sendPolicyNotification = async ({ policy, customer, vehicle, type }) => {
  const { appId, apiKey } = getConfig();
  const registration = vehicle?.registration || "your vehicle";
  const policyId = String(policy._id);
  const isUpcoming = type === "UPCOMING_5_MINUTES";
  const heading = isUpcoming
    ? "Policy starts in 5 minutes"
    : "Your policy is now active";
  const body = isUpcoming
    ? `Your cover for ${registration} starts at ${policy.startTime}.`
    : `${registration} is covered until ${policy.endTime}.`;

  const payload = {
    app_id: appId,
    target_channel: "push",
    include_aliases: {
      external_id: [String(customer._id)],
    },
    headings: { en: heading },
    contents: { en: body },
    url: `${getPublicOrigin()}/customer/policies/${policyId}`,
    data: {
      policyId,
      notificationType: type,
      registration,
    },
    web_push_topic: `policy-${policyId}`.slice(0, 64),
    ttl: isUpcoming ? 600 : 86400,
    priority: 10,
  };

  const response = await axios.post(ONESIGNAL_ENDPOINT, payload, {
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  return {
    id: response.data?.id || null,
    recipients: response.data?.recipients ?? null,
  };
};

module.exports = { sendPolicyNotification };
