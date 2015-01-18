var bg = chrome.extension.getBackgroundPage();

(function($) {

    chrome.runtime.connect();

    $(function() {

        var settings = bg.settings;
        // window.settings = bg.settings;
        settings.load();
        // console.log(settings);

        var inputDomain = $('#input-domain');
        var inputUserId = $('#input-userid');
        var inputViewId = $('#input-viewid');
        var buttonDetectUserId = $('#button-detectuserid');
        var buttonListUserViews = $('#button-viewselect');
        var buttonLogIn = $('#button-login');
        var buttonResetSort = $('#button-sort-reset');

        function load() {
            inputDomain.val(settings.zendeskDomain);
            inputUserId.val(settings.userID);
            inputViewId.val(settings.viewID);
        }

        function save() {
            settings.zendeskDomain = inputDomain.val();
            settings.userID = parseInt(inputUserId.val(), 10) || null;
            settings.viewID = parseInt(inputViewId.val(), 10) || null;
            clear_error_domain();
            settings.save();
            console.log('Saving to bg.settings');
        }

        function detect_user_id() {

            if (!inputDomain.val()) {
                show_error_domain();
                return;
            }

            buttonDetectUserId.attr('disabled', true);
            load(); // load to clear error messages

            bg.get_current_user()
                .then(function(response) {
                    buttonDetectUserId.removeAttr('disabled');
                    var userName = response.user.name;
                    var userId = response.user.id;
                    if (!userId) {
                        inputUserId.val('Unauthorized');
                        inputUserId.css('color', '#ec514e');
                    } else {
                        inputUserId.val(userId);
                        inputUserId.css('color', '#c6c8c8');
                        save();
                    }
                })
                .fail(function(response) {
                    buttonDetectUserId.removeAttr('disabled');
                    var statusText = response.statusText;
                    var statusCode = response.status;
                    inputUserId.val(statusText);
                    inputUserId.css('color', '#ec514e');
                    console.log(response);
                });
        }

        function list_user_views() {

            // Clean up dropdown menu
            $('ul.dropdown-menu').empty();
            buttonListUserViews.dropdown('disable');

            if (!inputDomain.val()) {
                show_error_domain();
                return;
            }

            buttonListUserViews.attr('disabled', true);
            load(); // load to clear error messages

            bg.get_current_user_views()
                .then(function(response) {
                    buttonListUserViews.removeAttr('disabled');
                    inputViewId.css('color', '#c6c8c8');
                    add_views_from_response_to_dropdown(response);
                    buttonListUserViews.dropdown('enable');
                    buttonListUserViews.dropdown('show');
                })
                .fail(function(response) {
                    buttonListUserViews.removeAttr('disabled');
                    var statusText = response.statusText;
                    var statusCode = response.status;
                    inputViewId.val(statusText);
                    inputViewId.css('color', '#ec514e');
                    console.log(response);
                });
        }

        function show_error_domain() {
            inputDomain.addClass('input-error');
        }

        function clear_error_domain() {
            inputDomain.removeClass('input-error');
        }

        function object_to_array(object) {

            var array = [];
            for (var key in object) {
                array.push(object[key]);
            }
            return array;
        }

        function add_views_from_response_to_dropdown(response) {

            $('ul.dropdown-menu').empty();
            var viewsObject = response.views;
            var viewsArray = object_to_array(viewsObject);
            var views = '';

            for (var view in viewsArray) {
                var thisView = viewsArray[view];

                // Skip inactive views
                if (thisView.active === false) {
                    continue;
                }

                views += '<li data-viewid="' + thisView.id + '" class="view-item">' +
                    thisView.title + '</li>';
            }

            $('ul.dropdown-menu').append(views);
            $('.view-item').click(handler_fill_viewid_input_with_selection);
        }

        function open_login_window() {

            if (settings.zendeskDomain) {
                url = 'https://' + settings.zendeskDomain + '.zendesk.com/agent';
                window.open(url);
            } else {
                show_error_domain();
            }
        }

        function handler_fill_viewid_input_with_selection() {

            var viewId = $(this).attr('data-viewid');
            inputViewId.val(viewId);
            buttonListUserViews.dropdown('hide');
            save();
        }

        function handler_reset_sort_order() {

            settings.set_defaults_sort();
            if (sortable) {
                sortable.sort(settings.sortOrder);
            }
            settings.save();
        }

        function create_sortable_object() {

            var sortingOrderItems = $('#sort-order-items')[0];
            var sortable = new Sortable(sortingOrderItems, {
                onSort: function() {
                    console.log(this.toArray());
                    settings.sortOrder = this.toArray();
                    settings.save();
                }
            });
            sortable.sort(settings.sortOrder);
            return sortable;
        }

        load();
        var sortable = create_sortable_object();
        
        inputDomain.on('input', save);
        inputUserId.on('input', save);
        inputViewId.on('input', save);
        buttonDetectUserId.click(detect_user_id);
        buttonListUserViews.click(list_user_views);
        buttonLogIn.click(open_login_window);
        buttonResetSort.click(handler_reset_sort_order);
        

    });

})(jQuery);
