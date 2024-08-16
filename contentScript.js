// Initialize flags
let mainLogicAlreadyRun = false;
let lastRecordId = "";
let lastUrl = "";
// Initialize global variables
let globalTableData = [];
// Initialize your MutationObserver and start observing
const observer = new MutationObserver((mutations) => {
  try {
    const currentUrl = window.location.href;

    if (currentUrl !== lastUrl) {
      console.log("URL has changed ----");
      const extractedData = extractObjectTypeFromURL(currentUrl);
      console.log("Result from extractObjectTypeFromURL:", extractedData);
      // Common clean-up
      removeSearchBox();
      globalTableData = [];
      lastRecordId = "";
      if (extractedData !== null) {
        console.log("extractedData NOT NULL----", extractedData);
        lastRecordId = extractedData.recordId;
        mainLogic(extractedData);
      } else {
        console.log("extractedData NULL----", extractedData);
      }

      lastUrl = currentUrl; // Update lastUrl to the current URL
    } else {
      console.log("URL has not changed. Skipping...");
    }
  } catch (error) {
    console.error("An error occurred in the MutationObserver:", error);
  }
});
// Configuration of the observer
const config = { childList: true, subtree: true };
// Start observing the entire body for changes
observer.observe(document.body, config);
// Main logic
async function mainLogic(extractedData) {
  try {
    mainLogicAlreadyRun = true;

    if (!extractedData) {
      console.log("Exiting mainLogic due to null extractedData.");
      return;
    }

    const response = await fetchMetadataAsync(extractedData);
    const tableData = prepareTableData(response);
    globalTableData = tableData;

    if (extractedData.recordId) {
      createSearchBox(tableData);
    }
  } catch (error) {
    console.error("An error occurred in mainLogic:", error);
  }
}
// Extract object type and record ID from the URL
function extractObjectTypeFromURL(url) {
  console.log("extractObjectTypeFromURL", url);
  const regex = /\/lightning\/r\/([A-Za-z0-9_]+)\/([a-zA-Z0-9]{15,18})\/view/;
  const match = url.match(regex);
  if (match) {
    return { objectType: match[1], recordId: match[2] };
  } else {
    // Reset if the URL doesn't match
    removeSearchBox();
    globalTableData = [];
    lastRecordId = "";
    return null;
  }
}
function prepareTableData(response = {}) {
  try {
    if (!response || !response.data) {
      mainLogicAlreadyRun = false;
      return;
    }
    const rawData = response.data;
    return Object.keys(rawData).map((key) => {
      const { type, value } = rawData[key];

      return {
        Field: key,
        Type: type,
        Value: value === null ? "null" : value,
      };
    });
  } catch (error) {
    console.error(
      "[ContentScript] prepareTableData  An error occurred:",
      error
    );
  }
}
async function fetchMetadataAsync(extractedData) {
  return new Promise((resolve, reject) => {
    // Check if the extension context is valid.
    if (chrome.runtime) {
      chrome.runtime.sendMessage(
        {
          action: "fetchMetadata",
          objectType: extractedData.objectType,
          recordId: extractedData.recordId,
          baseUrl: window.location.origin,
        },
        function (response) {
          if (chrome.runtime.lastError) {
            console.error(
              "[ContentScript] Error in sendMessage:",
              chrome.runtime.lastError.message
            );
            reject(chrome.runtime.lastError.message);
            return;
          }
          resolve(response);
        }
      );
    } else {
      const error = new Error("Extension context invalidated.");
      console.error("fetchMetadataAsync failed:", error);
      reject(error);
    }
  });
}
async function sendMessageToBackground(extractedData) {
  if (!extractedData) {
    return;
  }
  if (extractedData) {
    chrome.runtime.sendMessage(
      {
        action: "handleUrlChange",
        objectType: extractedData.objectType,
        recordId: extractedData.recordId,
        baseUrl: window.location.origin,
      },
      function (response) {
        if (chrome.runtime.lastError) {
          // Handle the error
          console.error(
            "[ContentScript] Error in sendMessage:",
            chrome.runtime.lastError.message
          );
          return;
        }

        globalTableData = [];
        removeSearchBox();
        // If there's no extracted data, remove the search container if it exists and return
        if (!extractedData) {
          const searchContainer = document.getElementById("searchContainer");
          if (searchContainer) {
            searchContainer.remove();
          }
          return;
        }
        // Prepare the table data and populate the global variable
        const tableData = prepareTableData(response);
        globalTableData = tableData;

        // Create the search box
        createSearchBox(tableData);
      }
    );
  }
}
window.addEventListener("unload", function () {
  observer.disconnect();
});
window.onerror = function (message, source, lineno, colno, error) {
  console.error("Uncaught Error:", error);
};
function removeSearchBox() {
  const searchContainer = document.getElementById("searchContainer");
  if (searchContainer) {
    searchContainer.remove();
  }
  const mainContainer = document.getElementById("mainContainer");
  if (mainContainer) {
    mainContainer.remove();
  }
}
function clearSearch(searchBox) {
  searchBox.value = "";
  resultList.innerHTML = ""; // Clear the result list
}
function filterAndDisplayData(searchText) {
  const filteredData = globalTableData.filter((row) => {
    return Object.values(row).some((value) =>
      String(value).toLowerCase().includes(searchText.toLowerCase())
    );
  });
}
function displayDataInConsole(tableData) {
  console.clear();
  console.table(tableData);
}

function createSearchBox(originalData) {
  let searchIcon = document.getElementById("searchIcon");
  if (!searchIcon) {
    // Create a container to hold everything
    const mainContainer = document.createElement("div");
    mainContainer.id = "mainContainer";
    mainContainer.style.position = "fixed";
    mainContainer.style.top = "60px";
    mainContainer.style.right = "5px";
    mainContainer.style.zIndex = "1000";

    // Create the search icon
    const searchIcon = document.createElement("span");
    searchIcon.innerText = "🔍";
    searchIcon.title = "Click to Search";
    searchIcon.id = "searchIcon";
    searchIcon.style.cursor = "pointer";
    searchIcon.style.fontSize = "18px"; // Reduced size
    searchIcon.style.background = "rgba(255, 255, 255, 0.8)";
    searchIcon.style.padding = "5px";
    searchIcon.style.borderRadius = "50%";
    searchIcon.style.animation = "blinking 1.5s infinite"; // Blinking effect

    // Append style for blinking animation in head
    const style = document.createElement("style");
    style.innerHTML = `
  @keyframes blinking {
    0% { opacity: 1; }
    50% { opacity: 0.5; }
    100% { opacity: 1; }
  }
`;
    document.head.appendChild(style);

    // Append searchIcon to mainContainer
    mainContainer.appendChild(searchIcon);

    // Append mainContainer to body
    document.body.appendChild(mainContainer);
    function clearSearch(searchBox, resultList, displayField) {
      searchBox.value = "";
      resultList.innerHTML = "";
      displayField.innerText = "";
    }
    searchIcon.onclick = function (e) {
      e.stopPropagation();
      searchIcon.style.display = "none";

      // Create a container for the search UI
      const searchContainer = document.createElement("div");
      searchContainer.id = "searchContainer";

      // Create the search input box
      const searchBox = document.createElement("input");
      searchBox.type = "text";
      searchBox.title = "Enter the field you want to search for...";
      searchBox.placeholder = "Search any field...";

      // Create the clear icon
      const clearIcon = document.createElement("span");
      clearIcon.title = "Click to clear";
      clearIcon.innerText = "❌";

      // Create the result list
      const resultList = document.createElement("ul");
      resultList.id = "resultList";

      // Append elements to the search container
      searchContainer.append(searchBox, clearIcon, resultList);
      mainContainer.appendChild(searchContainer);

      function displaySelectedValue(field, originalData, parentContainer) {
        const value = originalData.find((row) => row.Field === field).Value;
        const valueElement = document.createElement("div");
        valueElement.style.position = "relative"; // to position the copy button

        const copyButton = document.createElement("button");
        copyButton.innerText = "📋";
        copyButton.title = "Click to copy";
        copyButton.style.visibility = "hidden"; // Hidden by default
        copyButton.addEventListener("click", function () {
          navigator.clipboard.writeText(value);
          copyButton.innerText = "Copied!";
          copyButton.fontSize = "2px";
          setTimeout(() => {
            copyButton.innerText = "📋";
          }, 2000);
        });

        valueElement.addEventListener("mouseenter", function () {
          copyButton.style.visibility = "visible";
        });
        valueElement.addEventListener("mouseleave", function () {
          copyButton.style.visibility = "hidden";
        });

        valueElement.innerText = value;
        valueElement.appendChild(copyButton);

        parentContainer.appendChild(valueElement);
      }

      // Handle input in the search box
      searchBox.addEventListener("input", function () {
        resultList.innerHTML = "";
        const searchText = this.value.toLowerCase();

        const filteredData = originalData.filter((row) =>
          row.Field.toLowerCase().includes(searchText)
        );

        filteredData.forEach((row) => {
          const listItem = document.createElement("li");
          listItem.innerText = row.Field;
          listItem.style.cursor = "pointer";

          listItem.addEventListener("mouseenter", function () {
            this.style.backgroundColor = "#ddd";
          });
          listItem.addEventListener("mouseleave", function () {
            this.style.backgroundColor = "";
          });

          listItem.addEventListener("click", function () {
            // Update the searchBox with the selected field name
            searchBox.value = row.Field;
            // Clear previous value element if exists
            const existingValueElement = searchContainer.querySelector("div");
            if (existingValueElement) {
              existingValueElement.remove();
            }

            displaySelectedValue(row.Field, originalData, searchContainer);
            resultList.innerHTML = "";
          });

          resultList.appendChild(listItem);
        });
      });

      // Handle click on the clear icon
      clearIcon.addEventListener("click", function () {
        searchBox.value = "";
        resultList.innerHTML = "";
        const existingValueElement = searchContainer.querySelector("div");
        if (existingValueElement) {
          existingValueElement.remove();
        }
        searchContainer.style.display = "none";
        searchIcon.style.display = "block";
      });
    };
  }
}
