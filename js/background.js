var settings = {
    zendeskDomain: '',
    viewID: null,
    userID: null,

    load: function(callback) {
        var self = this;
        chrome.storage.local.get(null, function(loadedSettings) {
            self.zendeskDomain = loadedSettings.zendeskDomain || '';
            self.viewID = loadedSettings.viewID || null;
            self.userID = loadedSettings.userID || null;
            if (callback) {
                callback();
            }
            console.log("Settings loaded");
        });
    },
    save: function() {
        chrome.storage.local.set({
            'zendeskDomain': this.zendeskDomain,
            'viewID': this.viewID,
            'userID': this.userID
        });
        console.log("Settings saved");
    }
};

var model = {
    tickets: {},
    users: {},
    starred: [],
    currentlyMakingRequest: false,
    errorState: false,
    lastUpdated: null,

    toggle_star: function(ticketIdStr) {
        var ticketId = parseInt(ticketIdStr, 10);
        var index = this.starred.indexOf(ticketId);
        if (index === -1) {
            // if not starred, star
            this.starred.push(ticketId);
            console.log('Starred ' + ticketId);
        } else {
            // if starred, remove
            this.starred.splice(index, 1);
            console.log('Un-starred ' + ticketId);
        }
        refresh_popup();
        this.save();
    },
    load: function() {
        var self = this;
        chrome.storage.local.get(null, function(loadedSettings) {
            self.starred = loadedSettings.starred || [];
        });
    },
    save: function() {
        chrome.storage.local.set({
            'starred': this.starred,
        });
        console.log("Starred saved");
    }
};

function get_current_user() {
    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/users/me.json';
    return $.getJSON(url);
}

function get_current_user_views() {
    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/views.json';
    return $.getJSON(url);
}

function get_tickets() {
    // max 100 tickets, does not traverse multiple API pages

    model.currentlyMakingRequest = true;
    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/views/' + settings.viewID + '/tickets.json';
    return $.getJSON(url);
}

function get_ticket_audits(ticketId) {
    model.currentlyMakingRequest = true;
    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/tickets/' + ticketId + '/audits.json';
    return $.getJSON(url);
}

function get_ticket_audits_page(ticketId, page) {
    model.currentlyMakingRequest = true;
    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/tickets/' + ticketId + '/audits.json?page=' + page;

    return $.getJSON(url);
}

function process_audit_pages_from_response(auditResponsesArray) {
    var auditsForAllPages = [];
    for (var i = 0; i < auditResponsesArray.length; i++) {
        var JSONresponse = auditResponsesArray[i][0];
        var theseAudits = JSONresponse.audits;
        auditsForAllPages.push.apply(auditsForAllPages, theseAudits);
    }
    return auditsForAllPages;
}

function get_all_ticket_audits(ticketId) {
    // return promise that resolves with an array of all audits across
    // multiple pages

    return $.Deferred(function() {
        var self = this;

        get_ticket_audits(ticketId)

        .done(function() {
            var JSONresponse = arguments[0];
            var theseAudits = JSONresponse.audits;
            var numAudits = JSONresponse.count;
            var totalPages = Math.floor((numAudits - 1) / 100) + 1 || 1;
            var allAudits = [];
            var auditRequestsArray = [];

            // Store the first audit request's response
            allAudits.push.apply(allAudits, theseAudits);

            if (totalPages === 1) {
                self.resolve(allAudits);
                return;
            }

            // Process additional pages
            for (var page = 2; page <= totalPages; page++) {
                auditRequestsArray.push(get_ticket_audits_page(ticketId, page));
            }

            $.when.apply($, auditRequestsArray).then(function() {
                var auditResponsesArray = (
                    auditRequestsArray.length === 1 ? [arguments] : arguments
                );
                var additionalAudits = process_audit_pages_from_response(
                    auditResponsesArray);
                allAudits.push.apply(allAudits, additionalAudits);

                self.resolve(allAudits);
            });
        });
    });
}

function get_user_details(userId) {
    model.currentlyMakingRequest = true;
    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/users/' + userId + '.json';
    return $.getJSON(url);
}

function load_tickets_into_model(ticketsData) {
    // populates model.ticket as {ticket ID: ticket object}

    model.tickets = {};
    for (var i = 0; i < ticketsData.length; i++) {
        model.tickets[ticketsData[i].id] = ticketsData[i];
    }
}

function filter_events_for_comment(event) {
    return event.type === 'Comment';
}

function filter_events_for_public_comment_by_me(event) {
    return event.type === 'Comment' &&
        event.public === true &&
        event.author_id === settings.userID;
}

function generic_search_in_audits_with_filter(audits, filter) {
    var lastComment = null;

    for (var j = audits.length - 1; j >= 0 && lastComment === null; j--) {
        var createdDateTime = audits[j].created_at;
        var events = audits[j].events;

        // filter this audit's events for all comments
        var eventsFilteredAll = events.filter(filter);
        lastComment = eventsFilteredAll[0] || null;

        if (lastComment) {
            lastComment.created_at = createdDateTime;
        }
    }
    return lastComment;
}

function get_last_comment_from_audits(audits) {
    return generic_search_in_audits_with_filter(
        audits, filter_events_for_comment);
}

function get_last_comment_by_me_from_audits(audits) {
    return generic_search_in_audits_with_filter(
        audits, filter_events_for_public_comment_by_me);
}

function set_ticket_last_comments_from_audits(auditResponsesArray) {
    for (var i = 0; i < auditResponsesArray.length; i++) {
        var audits = auditResponsesArray[i];
        var ticketId = audits[0].ticket_id;

        console.log('Analyzing audits for ticket ID ' + ticketId +
            ', with a total of ' + audits.length + ' audits');
        model.tickets[ticketId]._lastComment =
            get_last_comment_from_audits(audits);
        model.tickets[ticketId]._lastPublicUpdateByMe =
            get_last_comment_by_me_from_audits(audits);
    }
}

function process_user_details(requesterArguments) {
    model.users = {};

    for (i = 0; i < requesterArguments.length; i++) {
        var user = requesterArguments[i][0].user;
        model.users[user.id] = user;
    }
}

function get_tickets_and_details() {
    // get all tickets in view
    // get each ticket's audit history
    // get latest comment event in audit history and latest public comment by me
    // write data to model.tickets

    tell_popup_loading();

    if (!settings.zendeskDomain) {
        send_popup_failure('No domain or view specified');
        model.errorState = true;
        return;
    }

    get_tickets().then(function(data) {
            load_tickets_into_model(data.tickets);

            // Return early if view has no tickets
            if (data.tickets.length === 0) {
                update_tickets_with_details();
                return;
            }

            // Store audit and user detail $.getJSON promises in array
            var auditRequests = [];
            var requesterIdRequests = [];
            var numTickets = data.tickets.length;

            for (var i = 0; i < numTickets; i++) {
                ticketId = data.tickets[i].id;
                requesterId = data.tickets[i].requester_id;

                // AJAX calls will fire now
                auditRequests.push(get_all_ticket_audits(ticketId));
                requesterIdRequests.push(get_user_details(requesterId));
            }

            // Create promises for completion of all audit and user detail calls
            var getRequesterDetails = $.when.apply($, requesterIdRequests);
            var getTicketAudits = $.when.apply($, auditRequests);

            // Process audits and user details when all calls are done
            $.when(getRequesterDetails, getTicketAudits).then(function() {
                var auditResponsesArray;
                var requesterArguments;

                if (numTickets === 1) {
                    // `arguments` will not be an array of arrays if there is
                    // only one request. This creates an array wrapper for
                    // data structure consistency
                    auditResponsesArray = [arguments[1]];
                    requesterArguments = [arguments[0]];
                } else {
                    auditResponsesArray = arguments[1];
                    requesterArguments = arguments[0];
                }

                set_ticket_last_comments_from_audits(auditResponsesArray);
                process_user_details(requesterArguments);
                update_tickets_with_details();
            });
        })
        .fail(function(e) {
            model.errorState = true;
            send_popup_failure(error_message(e.status));
        });
}

function update_tickets_with_details() {
    model.currentlyMakingRequest = false;
    model.errorState = false;
    update_time();
    refresh_popup();
}

function update_time() {
    model.lastUpdated = new Date();
}

function error_message(status) {
    var possibleErrors = {
        0: 'Request Unsent',
        400: 'Bad Request',
        401: 'Not Authorized. Please log in to Zendesk',
        403: 'Forbidden',
        404: 'Not Found. Check your Domain and View ID',
        500: 'Internal Server Error',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
    };

    var errorMsg;

    if (status in possibleErrors) {
        errorMsg = status + ": " + possibleErrors[status];
    } else {
        errorMsg = status;
    }

    return errorMsg.toString();
}

function tell_popup_loading() {
    try {
        chrome.extension.getViews({
            type: 'popup'
        })[0].loading();
    } catch (e) {
        console.log('Could not contact popup window');
    }
}

function refresh_popup() {
    console.log('Refreshing popup');
    try {
        chrome.extension.getViews({
            type: 'popup'
        })[0].refreshTickets();
    } catch (e) {
        console.log('Could not contact popup window');
    }
}

function send_popup_failure(error) {
    console.log('Sending error to popup: ' + error);
    try {
        chrome.extension.getViews({
            type: 'popup'
        })[0].failed(error);
    } catch (e) {
        console.log('Could not contact popup window');
    }
}

function launch_zd_link(objectID, isView) {
    var property;
    var typeUrl;

    if (isView) {
        property = 'show_filter';
        typeUrl = 'filters/';
    } else {
        property = 'ticket.index';
        typeUrl = 'tickets/';
    }

    var tabQuery = {
        url: '*://' + settings.zendeskDomain + '.zendesk.com/agent/*',
        // active: false
    };

    open_and_focus = function(tabs) {
        var ZDtab = tabs[0];

        // Run javascript in Zendesk window context
        if (ZDtab) {
            var actualCode = [
                '\'Zendesk.router.transitionTo("' + property + '",' +
                objectID + ');\''
            ].join();

            var js = ['var script = document.createElement("script");',
                'script.textContent = ' + actualCode + ';',
                'console.log(script);',
                'document.head.appendChild(script);'
            ].join('\n');

            chrome.tabs.executeScript(ZDtab.id, {
                code: js
            });
            chrome.tabs.update(ZDtab.id, {
                active: true
            });
            chrome.windows.update(ZDtab.windowId, {
                focused: true
            });
        } else {
            var newURL = 'https://' + settings.zendeskDomain +
                '.zendesk.com/agent/' + typeUrl + objectID;
            chrome.tabs.create({
                url: newURL
            });
        }
    };

    chrome.tabs.query(tabQuery, open_and_focus);
}

// Load settings, then get ticket audit and user details
settings.load(get_tickets_and_details);
model.load();
update_time();

// save settings when popup closes
chrome.runtime.onConnect.addListener(function(port) {
    port.onDisconnect.addListener(function() {
        console.log('Popup or Options closed');
        model.save();
    });
});
