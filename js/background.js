// var console = {};
// console.log = function() {};

var settings = {
    zendeskDomain: '',
    viewID: null,
    userID: null,
    sortOrder: [],

    set_defaults_sort: function() {
        this.sortOrder =  [
            'starred', 
            'auto',
            'responded',
            'priority',
            'wait'
        ];
        console.log('Setting default sort order');
    },
    load: function(callback) {
        var self = this;
        chrome.storage.local.get(null, function(loadedSettings) {
            self.zendeskDomain = loadedSettings.zendeskDomain || '';
            self.viewID = loadedSettings.viewID || null;
            self.userID = loadedSettings.userID || null;
            self.sortOrder = loadedSettings.sortOrder || null;
            if (callback) {
                callback();
            }
            if (!self.sortOrder) {
                self.set_defaults_sort();
            }
            console.log("Settings loaded");
        });
    },
    save: function() {
        chrome.storage.local.set({
            'zendeskDomain': this.zendeskDomain,
            'viewID': this.viewID,
            'userID': this.userID,
            'sortOrder': this.sortOrder
        });
        console.log("Settings saved");
    }
};

var model = {
    tickets: {},
    users: {},
    starred: [],
    currentlyMakingRequest: false,
    numRequestsTotal: 0,
    numRequestsDone: 0,
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
    model.numRequestsTotal += 1;

    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/views/' + settings.viewID + '/tickets.json';

    return $.getJSON(url).done(progress_increment);
}

function get_ticket_audits(ticketId) {
    model.currentlyMakingRequest = true;
    model.numRequestsTotal += 1;

    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/tickets/' + ticketId + '/audits.json';

    return $.getJSON(url).done(progress_increment);
}

function get_ticket_audits_page(ticketId, page) {
    model.currentlyMakingRequest = true;
    model.numRequestsTotal += 1;

    var url = 'https://' + settings.zendeskDomain +
        '.zendesk.com/api/v2/tickets/' + ticketId + '/audits.json?page=' + page;

    return $.getJSON(url).done(progress_increment);
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

function get_last_event_from_audits_that_satisfies_parameters(audits, parameters) {

    var lastEvent;

    // Do reverse find on a copy of audits array to preserve original
    var lastAudit = _.find(audits.slice(0).reverse(),
        function(audit) {
            lastEvent = _.findWhere(audit.events, parameters);
            return lastEvent;
        });

    if (lastEvent) {
        lastEvent.created_at = lastAudit.created_at;
    }

    return lastEvent;
}

function get_last_event_from_audits_if_satisfies_parameters(audits, parameters) {

    var lastAudit = _.last(audits);
    var lastEvent = _.findWhere(lastAudit.events, parameters);

    if (lastEvent) {
        lastEvent.created_at = lastAudit.created_at;
        lastEvent.author_id = lastAudit.author_id;
    }

    return lastEvent;
}

function get_last_comment_from_audits(audits) {

    return get_last_event_from_audits_that_satisfies_parameters(audits, {
        type: 'Comment'
    });
}

function get_last_comment_by_me_from_audits(audits) {

    return get_last_event_from_audits_that_satisfies_parameters(audits, {
        type: 'Comment',
        public: true,
        author_id: settings.userID
    });
}

function get_last_event_if_status_change_from_audits(audits) {

    return get_last_event_from_audits_if_satisfies_parameters(audits, {
        type: 'Change',
        field_name: 'status',
    });
}

function set_ticket_custom_properties_from_audits(auditResponsesArray) {

    for (var i = 0; i < auditResponsesArray.length; i++) {
        var audits = auditResponsesArray[i];
        var ticketId = audits[0].ticket_id;

        console.log('Analyzing audits for ticket ID ' + ticketId +
            ', with a total of ' + audits.length + ' audits');

        model.tickets[ticketId]._lastComment =
            get_last_comment_from_audits(audits);

        model.tickets[ticketId]._lastPublicCommentByMe =
            get_last_comment_by_me_from_audits(audits);

        model.tickets[ticketId]._lastEventStatusChange =
            get_last_event_if_status_change_from_audits(audits);
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


    if (!preflight_check()) {
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

                console.log(auditResponsesArray);
                set_ticket_custom_properties_from_audits(auditResponsesArray);
                process_user_details(requesterArguments);
                update_tickets_with_details();
            });
        })
        .fail(function(e) {
            model.errorState = true;
            send_popup_failure(error_message(e.status));
        });
}

function preflight_check() {
    if (!settings.zendeskDomain) {
        send_popup_failure('No domain specified');
        model.errorState = true;
        return false;
    } else if (!settings.userID) {
        send_popup_failure('No user ID specified');
        model.errorState = true;
        return false;
    } else if (!settings.viewID) {
        send_popup_failure('No view ID specified');
        model.errorState = true;
        return false;
    } else if (model.currentlyMakingRequest) {
        return false;
    }
    return true;
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

function update_tickets_with_details() {
    model.currentlyMakingRequest = false;
    model.errorState = false;
    update_time();
    refresh_popup();
    progress_all_done();
}

function update_time() {
    model.lastUpdated = new Date();
}

function progress_increment() {
    model.numRequestsDone += 1;

    // Don't send 100%; let progress_all_done() handle that
    if (model.numRequestsTotal > 0 &&
        model.numRequestsDone / model.numRequestsTotal * 100 < 100) {
        send_progress_to_popup();
    }
}

function progress_all_done() {
    send_progress_to_popup(100);
    model.numRequestsTotal = 0;
    model.numRequestsDone = 0;
}

function send_progress_to_popup(progress_value) {
    var minProgressValue = 5;

    if (!progress_value) {
        if (model.numRequestsTotal > 1) {
            var calculation =
                model.numRequestsDone / model.numRequestsTotal * 100;
            progress_value = (calculation > minProgressValue ?
                calculation :
                minProgressValue);

        } else if (model.numRequestsTotal === 1) {
            progress_value = minProgressValue;

        } else {
            progress_value = 0;
        }
    }
    // console.log("Total: " + model.numRequestsTotal + ", Done: " +
    //     model.numRequestsDone + ", Progress value: " + progress_value);

    try {
        var popupView = chrome.extension.getViews({
            type: 'popup'
        })[0].setProgress(progress_value);
    } catch (e) {
        // console.log('Could not contact popup window');
    }
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
    model.currentlyMakingRequest = false;
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
                'script.id = "chrome-zd-navigate"',
                'console.log(script);',
                'document.head.appendChild(script);',
                'document.head.removeChild(script);'
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
