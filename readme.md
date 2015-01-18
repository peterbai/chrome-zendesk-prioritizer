# Zendesk Ticket Prioritizer

A Chrome extension that lists a view's tickets in prioritized order.

![Popup](/screenshots/0-0-4-2/popup.png)

**Key features:**

* Indicates which tickets have received a public response today
* Easily star high-touch tickets 
* Customizable multi-attribute sorting of Zendesk tickets. Default order:
  1. Starred/unstarred
  2. Auto/user status change
  3. Answered/unanswered
  4. Priority
  5. Time since last public response

# Install

**Method 1**: Install from the Chrome Web Store: https://chrome.google.com/webstore/detail/zendesk-prioritizer/doplkcmbmmndfieconhlhpffkihmjaic

**Method 2**: Download this project as a zip and extract. Then, navigate to `chrome://extensions`, enable developer mode, and load the extracted folder as an unpacked extension.

# Release Notes

##v0.0.4.2
* Customizable sort options
* New sorting parameter: auto status change
* Popup UI stays at consistent height

##v0.0.4
* Settings page and popup UI tweaks
* Loading progress bar

##v0.0.3
* Options page
* Support for tickets with more than 100 audits

##v0.0.2
* Ability to star tickets
* Multi-attribute sorting

##v0.0.1
* Visual indicators for answered/unanswered
