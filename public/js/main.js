var socket;
var pendingMsg = [];
var msgId = 0;

if (typeof(is_admin) === 'undefined' || is_admin === null) {
    is_admin = false;
}

function newMission() {
    bootbox.dialog({
        message: '<form><div class="form-group row"><label for="nmName" class="col-sm-2 col-form-label">Mission Name</label><div class="col-sm-10"><input type="text" class="form-control" id="nmName" value=""></div></div></form>',
        title: 'Insert New Mission',
        buttons: {
            confirm: {
                label: 'Insert',
                className: 'btn-primary',
                callback: function () {
                    var mission = {};
                    mission.name = $('#nmName').val();
                    socket.send(JSON.stringify({
                        act: 'insert_mission',
                        arg: mission,
                        msgId: msgHandler()
                    }));
                }
            },
            cancel: {
                label: 'Cancel',
                className: 'btn-danger'
            }
        }
    });
}

// ---------------------------- SOCKET.IO MESSAGES / HANDLERS ----------------------------------
function msgHandler() {
    pendingMsg[msgId] = setTimeout(function () {
        for (m in pendingMsg) {
            clearTimeout(pendingMsg[m]);
        }
        clearInterval(socket.pingInterval);
        $('#modal-close').hide();
        $('#modal-header').html('Attention!');
        $('#modal-body').html('<p>Connection lost! Please refresh the page to continue!</p>');
        $('#modal-footer').html('');
        $('#modal-content').removeAttr('style');
        $('#modal-content').removeClass('modal-details');
        $('#modal').removeData('bs.modal').modal({
            backdrop: 'static',
            keyboard: false
        });
    }, 30000);
    return msgId++;
}

$(window).on('load', function () {
    // prevent bootbox from reloading on submit / enter
    $(document).on("submit", ".bootbox form", function (e) {
        e.preventDefault();
        $(".bootbox .btn-primary").click();
    });

    // ---------------------------- SOCKETS ----------------------------------
    if (location.protocol === 'https:') {
        socket = new WebSocket('wss://' + window.location.host + '/cop/');
        wsdb = new WebSocket('wss://' + window.location.host + '/cop/');
    } else {
        socket = new WebSocket('ws://' + window.location.host + '/cop/');
        wsdb = new WebSocket('ws://' + window.location.host + '/cop/');
    }

    socket.onopen = function () {
        socket.pingInterval = setInterval(function ping() {
            socket.send(JSON.stringify({
                act: 'ping',
                arg: '',
                msgId: msgHandler()
            }));
        }, 10000);
        setTimeout(function () {
            console.log('connect');
            socket.send(JSON.stringify({
                act: 'main',
                arg: '',
                msgId: msgHandler()
            }));
            socket.send(JSON.stringify({
                act: 'get_missions',
                arg: '',
                msgId: msgHandler()
            }));
        }, 100);
    };

    // message handler
    socket.onmessage = function (msg) {
        msg = JSON.parse(msg.data);
        switch (msg.act) {
            // general
            case 'ack':
                clearTimeout(pendingMsg[msg.arg]);
                delete pendingMsg[msg.arg];
                break;

            case 'error':
                $('#modal-close').hide();
                $('#modal-header').html('Error!');
                $('#modal-body').html('<p>' + msg.arg.text + '</p>');
                $('#modal-footer').html('');
                $('#modal-content').removeAttr('style');
                $('#modal-content').removeClass('modal-details');
                $('#modal').removeData('bs.modal').modal({});
                break;

            case 'get_missions':
                missionsTabulator.setData(msg.arg);
                break;

            case 'insert_mission':
                missionsTabulator.addRow(msg.arg);
                break;

            case 'update_mission':
                missionsTabulator.updateRow(msg.arg._id, msg.arg);
                break;

            case 'delete_mission':
                missionsTabulator.deleteRow(msg.arg);
                break;
        }
    }

    $('#newMission').click(function () {
        newMission();
    });
    missionsTabulator = new Tabulator("#missionsTable", {
        layout: "fitColumns",
        index: '_id',
        cellEdited: function (cell) {
            var row = cell.getRow().getData();
            delete row.username;
            socket.send(JSON.stringify({
                act: 'update_mission',
                arg: cell.getRow().getData(),
                msgId: msgHandler()
            }));
        },
        columns: [{
                title: 'Mission ID',
                field: '_id',
                visible: false
            },
            {
                title: 'Mission Name',
                field: 'name',
                editable: function () {
                    return is_admin;
                },
                editor: 'input'
            },
            {
                title: 'Creator',
                field: 'username'
            },
            {
                title: 'Launch',
                formatter: 'link',
                formatterParams: {
                    label: 'Open Mission',
                    urlPrefix: 'cop?mission=',
                    urlField: '_id'
                }
            },
        ]
    });
    if (is_admin) {
        missionsTabulator.addColumn({
            headerSort: false,
            formatter: 'buttonCross',
            width: 40,
            align: 'center',
            cellClick: function (e, cell) {
                deleteConfirm('deleteMission(\'' + cell.getRow().getData()['_id'] + '\')');
                
            }
        }, false, null);
    }

});

function deleteMission(id) {
    socket.send(JSON.stringify({
        act: 'delete_mission',
        arg: {
            _id: id
        },
        msgId: msgHandler()
    }));
}
