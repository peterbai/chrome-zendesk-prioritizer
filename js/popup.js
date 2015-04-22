(function($) {

    chrome.runtime.connect();

    $(function() {

        var bg = chrome.extension.getBackgroundPage();

        var today = {
            now: null,
            startTime: null,
            endTime: null
        };

        function update_start_and_end_time() {

            var d1 = new Date();
            var d2 = new Date();

            d1.setHours(0, 0, 0, 0);
            d2.setHours(23, 59, 0, 0);

            today.now = new Date();
            today.startTime = d1;
            today.endTime = d2;
        }

        function answered_by_me_today(date) {

            var answeredDate = new Date(date);

            if (today.startTime < answeredDate && answeredDate < today.endTime) {

                return true;
            } else {
                return false;
            }
        }

        function get_property(object, key) {

            return key.split('.').reduce(function(obj, param) {
                return ((typeof obj === 'undefined' || obj === null) ? null : obj[param]);
            }, object);
        }

        function sort_waitTime(a, b) {
            // sort by descending wait time (longest wait time at top)

            var timeA = new Date(get_property(a, '_lastPublicCommentByMe.created_at'));
            var timeB = new Date(get_property(b, '_lastPublicCommentByMe.created_at'));
            return timeA - timeB;
        }

        function sort_responded(a, b) {
            // sort by asending order of responded state (unresponded at top)

            var timeA = new Date(get_property(a, '_lastPublicCommentByMe.created_at'));
            var timeB = new Date(get_property(b, '_lastPublicCommentByMe.created_at'));
            respondedA = (today.startTime < timeA && timeA < today.endTime ? 1 : 0);
            respondedB = (today.startTime < timeB && timeB < today.endTime ? 1 : 0);
            return respondedA - respondedB;
        }

        function sort_priority(a, b) {
            // sort by descending priority (high priority on top)

            var priorityA = convert_priority_to_int(a.priority);
            var priorityB = convert_priority_to_int(b.priority);

            function convert_priority_to_int(priority) {
                switch (priority) {
                    case 'low':
                        return 1;
                    case null:
                        return 2;
                    case 'normal':
                        return 2;
                    case 'high':
                        return 3;
                    case 'urgent':
                        return 4;
                    default:
                        console.log('Could not match priority string: ' + priority);
                }
            }
            return priorityB - priorityA;
        }

        function sort_starred(a, b) {

            var starred = bg.model.starred;

            var starredA = (starred.indexOf(a.id) > -1 ? 1 : 0);
            var starredB = (starred.indexOf(b.id) > -1 ? 1 : 0);

            return starredB - starredA;
        }

        function sort_auto_status_change(a, b) {

            var autoA = (get_property(a, '_lastEventStatusChange.author_id') === -1 ? 1 : 0);
            var autoB = (get_property(b, '_lastEventStatusChange.author_id') === -1 ? 1 : 0);

            return autoA - autoB;
        }

        function create_sort_function_from_settings() {

            var sortOrder = bg.settings.sortOrder;
            var sortFunctionArray = [];

            // sourced from https://github.com/Teun/thenBy.js
            // this anonymous function takes no arguments and returns the function `extend`
            var firstBy = (function() {
                function extend(func) {
                    func.thenBy = tb;
                    return func; // returns a function that has a `.thenBy` function parameter
                }

                function tb(y) {
                        // `this` refers to the function that called `.thenBy`
                        var x = this;

                        // returns a function that has another `.thenBy` function parameter
                        return extend(function(a, b) {

                            // if x(a,b) === 0, return y(a,b)
                            // (if this function deems items equal, go to next function)
                            return x(a, b) || y(a, b);
                        });
                    }
                    // `extend` is assigned to variable `firstBy`
                return extend;
            })();

            _.each(sortOrder, function(element) {
                switch (element) {
                    case 'starred':
                        sortFunctionArray.push(sort_starred);
                        break;
                    case 'auto':
                        sortFunctionArray.push(sort_auto_status_change);
                        break;
                    case 'responded':
                        sortFunctionArray.push(sort_responded);
                        break;
                    case 'priority':
                        sortFunctionArray.push(sort_priority);
                        break;
                    case 'wait':
                        sortFunctionArray.push(sort_waitTime);
                        break;
                    default:
                        console.log('Unrecognized sort function string: ' + element);
                }
            });

            var sortingFunction = firstBy(_.first(sortFunctionArray));

            _.each(_.rest(sortFunctionArray), function(element) {
                sortingFunction = sortingFunction.thenBy(element);
            });

            return sortingFunction;
        }

        function show_tickets() {

            // don't try to populate tickets unless bg has valid data
            if (bg.model.currentlyMakingRequest || bg.model.errorState) {
                return;
            }

            // clean up
            $('#error').css('display', 'none');
            $('ul').empty();

            var ticketsArray = _.values(bg.model.tickets);

            if (ticketsArray.length === 0) {
                $('ul').append('<div class="notification-li">No tickets in view</div>');
                return;
            }

            // Multi-attribute sorting
            ticketsArray.sort(create_sort_function_from_settings());

            // Generate HTML for ticket items
            var tickets = '';
            var starred = bg.model.starred;

            for (var index in ticketsArray) {

                var thisTicket = ticketsArray[index];

                var subjectText = thisTicket.subject;

                var descriptionRawText = thisTicket._lastComment.body;
                var descriptionText = _.escape(descriptionRawText);

                var latestCommentDate = new Date(thisTicket._lastComment.created_at);
                var latestCommentTimeStr = moment(latestCommentDate).fromNow();

                var isStarred = (starred.indexOf(thisTicket.id) > -1 ? true : false);

                var priority = thisTicket.priority || '';

                var answeredToday;
                if (thisTicket._lastPublicCommentByMe) {
                    answeredToday = answered_by_me_today(
                        thisTicket._lastPublicCommentByMe.created_at);
                } else {
                    answeredToday = false;
                }

                var autoStatusChange;
                if (thisTicket._lastEventStatusChange) {
                    autoStatusChange = (thisTicket._lastEventStatusChange.author_id === -1 ? 'true' : 'false');
                } else {
                    // last event was not a status change
                    autoStatusChange = 'false';
                }

                var currentStatus;
                if (thisTicket._lastEventStatusChange) {
                    currentStatus = thisTicket._lastEventStatusChange.value;
                } else {
                    currentStatus = 'none';
                }

                var requesterText = bg.model.users[thisTicket.requester_id].name;

                tickets += '<li data-ticketid="' + thisTicket.id + '" class=tickets-li>' +
                    '<span class="subject">' + subjectText + '</span>' +
                    '<div class="priority ' + priority + '"></div>' +
                    '<div class="starred ' + isStarred + '"></div>' +
                    '<div class="responded ' + answeredToday + '"></div>' +
                    '<div class="auto ' + autoStatusChange + '"></div>' +
                    '<div class="status ' + currentStatus + '"></div>' +
                    '<div class="description">' + descriptionText + '</div>' +
                    '<div class="requester">' + requesterText + '</div>' +
                    '<div class="time">' + latestCommentTimeStr + '</div>' +
                    '</li>';

                var debugString = sprintf(
                    "starred: %5s | auto: %5s | responded: %5s | priority: %6s | wait: %20s",
                    isStarred,
                    autoStatusChange,
                    answeredToday,
                    priority,
                    get_property(thisTicket, '_lastPublicCommentByMe.created_at')
                );
                // console.log(debugString);
            }
            // append everything at once to avoid "growing" the content div
            $('ul').append(tickets);
        }

        function add_ticket_click_handlers() {

            // console.log('Adding click handlers');
            $('.tickets-li').click(handler_launch_ticket);
            $('.starred').click(handler_toggle_favorite);
        }

        function handler_launch_ticket(e) {

            var ID = $(this).attr('data-ticketId');
            console.log('Opening ticket ' + ID);
            bg.launch_zd_link(ID);
        }

        function handler_launch_view(e) {

            var viewId = bg.settings.viewID;
            if (viewId) {
                bg.launch_zd_link(viewId, true);
            } else {
                self.failed('No view ID specified');
            }
        }

        function handler_toggle_favorite(e) {

            e.stopPropagation(); // stop click event on div underneath from firing
            var ID = $(this).parent().attr('data-ticketId');
            console.log('toggling starred for ' + ID);
            bg.model.toggle_star(ID);
        }

        window.loading = function() {

            $('#loading').html('Loading...');
        };

        window.setProgress = function(progress_value) {

            var progressbarElement = $("#progressbar");

            progressbarElement.css('opacity', '1');
            progressbarElement.progressbar({
                value: progress_value
            });

            if (progress_value >= 100) {
                progressbarElement.css('opacity', '0');
            }
        };

        window.refreshTickets = function() {

            console.log('Background told me to refresh');
            show_tickets();
            add_ticket_click_handlers();
            $('#loading').html('');
        };

        window.failed = function(error) {

            console.log('Background experienced error');
            $('#error').html('Error - ' + error);
            $('#error').css('display', 'block');
            $('#loading').html('');
            $('ul').empty();
        };

        update_start_and_end_time();
        show_tickets();
        add_ticket_click_handlers();
        $('#view-icon').click(handler_launch_view); // only needs to attach once
        bg.get_tickets_and_details();

    });

})(jQuery);
