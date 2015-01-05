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

            today.now = new Date();

            var d1 = new Date(),
                d2 = new Date();

            d1.setHours(0, 0, 0, 0);
            d2.setHours(23, 59, 0, 0);
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

        function object_to_array(object) {

            var array = [];
            for (var key in object) {
                array.push(object[key]);
            }
            return array;
        }

        function get_property(object, key) {

            return key.split('.').reduce(function(obj, param) {
                return (typeof obj === 'undefined' || obj === null) ? null : obj[param];
            }, object);
        }

        function sort_waitTime(a, b) {
            // sort by descending wait time (longest wait time at top)

            var timeA = new Date(get_property(a, '_lastPublicUpdateByMe.created_at'));
            var timeB = new Date(get_property(b, '_lastPublicUpdateByMe.created_at'));
            return timeA - timeB;
        }

        function sort_responded(a, b) {
            // sort by asending order of responded state (unresponded at top)

            var timeA = new Date(get_property(a, '_lastPublicUpdateByMe.created_at'));
            var timeB = new Date(get_property(b, '_lastPublicUpdateByMe.created_at'));
            respondedA = (today.startTime < timeA && timeA < today.endTime) ? 1 : 0;
            respondedB = (today.startTime < timeB && timeB < today.endTime) ? 1 : 0;
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

            var starredA = (starred.indexOf(a.id) > -1) ? 1 : 0;
            var starredB = (starred.indexOf(b.id) > -1) ? 1 : 0;

            return starredB - starredA;
        }

        // learning from https://github.com/Teun/thenBy.js
        var firstBy = (function() { // this function takes no arguments and returns another function
            function extend(func) {
                func.thenBy = tb;
                return func; // returns a function that has a `.thenBy` function parameter
            }

            function tb(y) {
                var x = this; // `this` refers to the function that called `.thenBy`
                return extend(function(a, b) { // returns a function that has another `.thenBy` function parameter
                    return x(a, b) || y(a, b); // if x(a,b) === 0, return y(a,b) (if this function deems items equal, go to next function)
                });
            }
            return extend; // this is then assigned to `firstBy`
        })();

        function show_tickets() {

            // don't try to populate tickets unless bg has valid data
            if (bg.model.currentlyMakingRequest || bg.model.errorState) {
                return;
            }

            // clean up
            $('#error').css('display', 'none');
            $('ul').empty();

            var ticketsArray = object_to_array(bg.model.tickets);

            if (ticketsArray.length === 0) {
                $('ul').append('<div class="notification-li">No tickets in view</div>');
                return;
            }

            // Multi-attribute sorting
            ticketsArray.sort(firstBy(sort_starred).thenBy(sort_responded).thenBy(sort_priority).thenBy(sort_waitTime));

            var tickets = '';
            var starred = bg.model.starred;

            for (var index in ticketsArray) {

                var thisTicket = ticketsArray[index];

                var latestCommentBody = thisTicket._lastComment.body;
                var latestCommentDate = new Date(thisTicket._lastComment.created_at);
                var latestCommentTimeStr = moment(latestCommentDate).fromNow();
                var description = '';
                if (latestCommentBody.length > 152) {
                    description = latestCommentBody.substring(0, 151) + '... [' + latestCommentTimeStr + ']';
                } else {
                    description = latestCommentBody + ' [' + latestCommentTimeStr + ']';
                }
                var subject = thisTicket.subject;
                if (subject.length > 100) {
                    subject = subject.substring(0, 99) + '...';
                }
                var priority = thisTicket.priority || '';
                var answeredToday;
                if (thisTicket._lastPublicUpdateByMe) {
                    answeredToday = answered_by_me_today(
                        thisTicket._lastPublicUpdateByMe.created_at);
                } else {
                    answeredToday = false;
                }

                var isStarred = (starred.indexOf(thisTicket.id) > -1) ? true : false;
                var requesterName = bg.model.users[thisTicket.requester_id].name;

                // var requester = bg.model.users[];

                tickets += '<li data-ticketid="' + thisTicket.id + '" class=tickets-li>' + subject +
                    '<div class="responded ' + answeredToday + '"></div>' +
                    '<div class="priority ' + priority + '"></div>' +
                    '<div class="starred ' + isStarred + '"></div>' +
                    '<div class="description">' + description + '</div>' +
                    '<div class="requester">' + requesterName + '</div>' +
                    '</li>';
            }

            $('ul').append(tickets); // appending everything at once fixes the unwanted "grow" effect of appending one at a time
            add_ellipses();
        }

        function add_ticket_click_handlers() {

            // console.log('Adding click handlers');
            $('.tickets-li').click(handler_launch_ticket);
            $('.starred').click(handler_toggle_favorite);
        }

        function add_ellipses() {
            $('.requester').dotdotdot();
            // $('.description').dotdotdot({
            //     height:20
            // });
        }

        function handler_launch_ticket() {

            var ID = $(this).attr('data-ticketId');
            console.log('Opening ticket ' + ID);
            bg.launch_zd_link(ID);
        }

        function handler_launch_view() {

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
