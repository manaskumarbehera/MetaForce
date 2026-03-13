let contentScriptLoadedTabs = new Set();
const API_VERSION = "v58.0";
function sendError(sendResponse, message) {
  sendResponse({ error: message });
}
function sendSuccess(sendResponse, data) {
  sendResponse({ data: data });
}
async function getAuthToken(domain) {
  return new Promise((resolve, reject) => {
    chrome.cookies.get({ url: `https://${domain}`, name: "sid" }, (cookie) => {
      if (cookie && cookie.value) {
        resolve(cookie.value);
      } else {
        reject(new Error("SID cookie not found or has no value"));
      }
    });
  });
}

async function fetchData(url, sidAuthToken) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${sidAuthToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(JSON.stringify(error));
  }

  return response.json();
}

async function fetchObjectMetadata(objectType, recordId, domain) {
  const sidAuthToken = await getAuthToken(domain);
  const endpointMetaUrl = `https://${domain}/services/data/${API_VERSION}/sobjects/${objectType}/describe/`;
  const endpointRecordUrl = `https://${domain}/services/data/${API_VERSION}/sobjects/${objectType}/${recordId}/`;

  const [metadata, record] = await Promise.all([
    fetchData(endpointMetaUrl, sidAuthToken),
    fetchData(endpointRecordUrl, sidAuthToken),
  ]);

  const combinedData = {};

  for (const field of metadata.fields) {
    const { name, type } = field;
    combinedData[name] = {
      type,
      value: record[name],
    };
  }

  return combinedData;
}

async function handleFetchMetadata(message, sender, sendResponse) {
  let hasSentData = false;
  let fetchAndRespond = async (cookieDomain) => {
    try {
      const data = await fetchObjectMetadata(
        message.objectType,
        message.recordId,
        cookieDomain
      );
      if (!hasSentData) {
        sendSuccess(sendResponse, data);
        hasSentData = true;
      }
    } catch (error) {
      if (!hasSentData) {
        sendError(sendResponse, error.message);
        hasSentData = true;
      }
    }
  };

  // Rest of the cookie fetching code here...
  chrome.cookies.get(
    { url: message.baseUrl, name: "sid", storeId: sender.tab.cookieStoreId },
    (cookie) => {
      if (!cookie) {
        sendResponse(null);
        return;
      }
      let [orgId] = cookie.value.split("!");
      chrome.cookies.getAll(
        {
          name: "sid",
          domain: "salesforce.com",
          secure: true,
          storeId: sender.tab.cookieStoreId,
        },
        (cookies) => {
          let sessionCookie = cookies.find((c) =>
            c.value.startsWith(orgId + "!")
          );
          if (sessionCookie) {
            fetchAndRespond(sessionCookie.domain); // Replace fetchObjectMetadata with fetchAndRespond
          } else {
            // If sessionCookie is not found in 'salesforce.com', try 'cloudforce.com'
            chrome.cookies.getAll(
              {
                name: "sid",
                domain: "cloudforce.com",
                secure: true,
                storeId: sender.tab.cookieStoreId,
              },
              (cookies) => {
                sessionCookie = cookies.find((c) =>
                  c.value.startsWith(orgId + "!")
                );
                if (sessionCookie) {
                  fetchAndRespond(sessionCookie.domain);
                } else {
                  sendResponse(null);
                }
              }
            );
          }
        }
      );
    }
  );
}

// Message Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "CONTENT_SCRIPT_LOADED":
      if (sender.tab && sender.tab.id)
        contentScriptLoadedTabs.add(sender.tab.id);
      sendResponse({ status: "ok" });
      break;
    case "fetchMetadata":
    case "handleUrlChange":
      handleFetchMetadata(message, sender, sendResponse);
      return true;
    default:
      sendResponse({ status: "unexpected_message" });
      break;
  }
});
