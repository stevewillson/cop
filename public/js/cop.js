function getParameterByName(name, url) {
    if (!url) url = window.location.href;
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}
mission_id = getParameterByName('mission');

// ---------------------------- PERMISSIONS & BUTTONS ----------------------------------
if (!permissions)
    permissions = [];
var diagram_rw = false;
var details_rw = false;

// more permissions stuff
var users_rw = false;
var notes_rw = false;
if (permissions.indexOf('all') !== -1 || permissions.indexOf('manage_users') !== -1)
        users_rw = true;
if (permissions.indexOf('all') !== -1 || permissions.indexOf('modify_details') !== -1)
        details_rw = true;
if (permissions.indexOf('all') !== -1 || permissions.indexOf('modify_notes') !== -1) {
        notes_rw = true;
        $("#newNoteButton").prop('disabled', false);
}

// ---------------------------- MINIMAP ----------------------------------
var minimap = document.getElementById('minimapCanvas');
var minimapBg = document.getElementById('minimapBgCanvas');
var minimapCtx = minimap.getContext('2d');
var minimapBgCtx = minimapBg.getContext('2d');
minimap.width = minimapBg.width = 100;
minimap.height = minimapBg.height = 100;

// ---------------------------- GLOBALS ----------------------------------
var settings = {'zoom': 1.0, 'x': Math.round($('#diagramJumbo').width()/2), 'y': Math.round(700/2), 'diagram': 700, 'tools': 400, 'notes': 400, 'files': 400};
var earliest_messages = {}; //= 2147483647000;
var creatingLink = false;
var userSelect = [];
var objectsLoaded = null;
var updatingObject = false;
var socket;
var toolbarState = false;
var firstNode = null;
var SVGCache = {};
var tempLinks = [];
var guides = {};
var resizeTimer = null;
var updateSettingsTimer = null;
var objectMovingTimer = null;
var activeToolbar = null;
var activeTable = 'chat';
var activeChannel = 'log';
var chatPosition = {};
var objectSearchResults = [];
var objectSearchPtr = null;
var firstChat = true;
var unreadMessages = {};
var lastClick = null;
var msgId = 0;
var pendingMsg = [];
var lastFillColor = '#000000';
var lastStrokeColor = '#ffffff';
var windowManager = null;
var canvasClipboard = [];
var settingsTabulator;

var wsdb;
var openDocs = {};
var shareDBConnection;

// ---------------------------- LOADING / CACHING OF STUFF ----------------------------------
// check if shapes are chached before loading canvas
function checkIfShapesCached(msg) {
    if (objectsLoaded.length == 0) {
        console.log('cached');
        for (var o in msg) {
            objectsLoaded.push(false);
            addObjectToCanvas(msg[o]);
        }
        checkIfObjectsLoaded();
    } else {
        setTimeout(function() {
            checkIfShapesCached(msg);
        }, 50);
    }
}

// check if objects are all added to the canvas before first draw
// we're basically ready after this
function checkIfObjectsLoaded() {
    if (objectsLoaded.length == 0) {
        console.log('objects loaded');
        $('#modal').modal('hide');
        //FIXME
        // objects loaded, update the events tracker
        updateLinks();
        updateMinimapBg();
        canvas.requestRenderAll();
        canvas.renderOnAddRemove = true;
    } else {
        setTimeout(checkIfObjectsLoaded, 50);
    }
}

// grab icons from the server
function getIcon(icon, cb) {
    var path = 'images/icons/';
    if (!SVGCache[icon]) {
        $.get(path + icon, function(data) {
            fabric.loadSVGFromString(data, function(objects, options) {
                SVGCache[icon] = fabric.util.groupSVGElements(objects, options);
                if (cb) {
                    cb();
                }
                objectsLoaded.pop();
            });
        }, 'text').fail(function() {
            $.get(path + 'missing.svg', function(data) {
                fabric.loadSVGFromString(data, function(objects, options) {
                    SVGCache[icon] = fabric.util.groupSVGElements(objects, options);
                    if (cb) {
                        cb();
                    }
                    objectsLoaded.pop();
                });
            }, 'text')
        });
    } else {
        objectsLoaded.pop();
        if (cb) {
            cb();
        }
    }
}


// ---------------------------- SETTINGS COOKIE ----------------------------------
function loadSettings() {
    if (decodeURIComponent(document.cookie) === '')
        document.cookie = "mcscop-settings=" + JSON.stringify(settings);
    var dc = decodeURIComponent(document.cookie);
    settings = JSON.parse(dc.split('mcscop-settings=')[1]);
    $('#diagramJumbo').height(settings.diagram);
    canvas.setZoom(settings.zoom);
    canvas.relativePan({ x: settings.x, y: settings.y });
}

function updateSettings() {
    if (updateSettingsTimer)
        window.clearTimeout(updateSettingsTimer);
    updateSettingsTimer = setTimeout(function() {
            document.cookie = "mcscop-settings=" + JSON.stringify(settings);
    }, 100);
}


// ---------------------------- Minimap Functions ----------------------------------
function updateMinimap() {
    var scaleX = 100 / (MAXWIDTH * 2);
    var scaleY = 100 / (MAXHEIGHT * 2);
    var zoom = canvas.getZoom();
    var mLeft = (MAXHEIGHT - settings.x / zoom) * scaleX;
    var mTop = (MAXHEIGHT - settings.y / zoom) * scaleY;
    var mWidth = (canvas.width / zoom) * scaleX;
    var mHeight = (canvas.height / zoom) * scaleY;
    minimapCtx.clearRect(0, 0, minimapCtx.canvas.width, minimapCtx.canvas.height);
    minimapCtx.beginPath();
    minimapCtx.rect(mLeft, mTop, mWidth, mHeight);
    minimapCtx.stroke();
}

function updateMinimapBg() {
    var scaleX = 100 / (MAXWIDTH * 2);
    var scaleY = 100 / (MAXHEIGHT * 2);
    minimapBgCtx.clearRect(0, 0, minimapCtx.canvas.width, minimapCtx.canvas.height);
    for (var i = 0; i < canvas.getObjects().length; i++) {
        if (canvas.item(i).objType === 'icon' || canvas.item(i).objType === 'shape') {
            minimapBgCtx.fillRect((MAXWIDTH + canvas.item(i).left) * scaleX, (MAXHEIGHT + canvas.item(i).top) * scaleY, 2, 2);
        }
    }
}


// ---------------------------- SOCKET.IO MESSAGES / HANDLERS ----------------------------------
function msgHandler() {
    pendingMsg[msgId] = setTimeout(function() {
        for (m in pendingMsg) {
            clearTimeout(pendingMsg[m]);
        }
        clearInterval(socket.pingInterval);
        canvas.clear();
        canvas.requestRenderAll();
        $('#modal-close').hide();
        $('#modal-header').html('Attention!');
        $('#modal-body').html('<p>Connection lost! Please refresh the page to continue!</p>');
        $('#modal-footer').html('');
        $('#modal-content').removeAttr('style');
        $('#modal-content').removeClass('modal-details');
        $('#modal').removeData('bs.modal').modal({backdrop: 'static', keyboard: false});
    }, 30000);
    return msgId++; 
}

// send chat message to db
function sendChatMessage(msg, channel) {
    socket.send(JSON.stringify({act: 'insert_chat', arg: {channel: channel, text: msg}, msgId: msgHandler()}));
}

// show message above canvas for link creation, etc
function showMessage(msg, timeout) {
    $('#message').html('<span class="messageHeader">' + msg + '</span>');
    $('#message').show();
    if (timeout !== undefined) {
        setTimeout(function() {
            $('#message').html('');
            $('#message').hide();
        }, timeout * 1000);
    }
}

//download diagram to png
function downloadDiagram(link) {
    var viewport = canvas.viewportTransform;
    canvas.setHeight(MAXHEIGHT * 2);
    canvas.setWidth(MAXWIDTH * 2);
    canvas.viewportTransform = [1, 0, 0, 1, MAXWIDTH, MAXHEIGHT];
    link.href = canvas.toDataURL('png');
    link.download = 'diagram.png';
    canvas.viewportTransform = viewport;
    resizeCanvas();
    canvas.requestRenderAll();
}

// setup times for cop clocks
function startTime() {
    var today = new Date();
    var eh = today.getHours();
    var uh = today.getUTCHours();
    var m = today.getMinutes();
    var s = today.getSeconds();
    m = addZero(m);
    s = addZero(s);
    $('#est').html('Local: ' + eh + ":" + m + ":" + s);
    $('#utc').html('UTC: ' + uh + ":" + m + ":" + s);
    var t = setTimeout(startTime, 500);
}

function deleteObjectConfirm() {
    $('#modal-title').text('Are you sure?');
    $('#modal-body').html('<p>Are you sure you want to delete this object?</p><p>Deleting an object will delete all attached notes.</p>');
    $('#modal-footer').html('<button type="button btn-primary" class="button btn btn-danger" data-dismiss="modal" onClick="cop.deleteObject();">Yes</button> <button type="button btn-primary" class="button btn btn-default" data-dismiss="modal">No</button>');
    $('#modal-content').removeAttr('style');
    $('#modal-content').removeClass('modal-details');
    $('#modal').modal('show')
}

function getUserSelect() {
    userSelect.sort(function(a, b) {
        return a.username.localeCompare(b.name);
    });
    var user = {};
    for (var i = 0; i < userSelect.length; i++) {
        user[userSelect[i]._id] = userSelect[i].username;
    }
    return user;
}

function getObjectSelect() {
    var res = ':';
    var objs = canvas.getObjects();
    objs.sort(function(a, b) {
        if (!a.name_val || !b.name_val)
            return 0;
        return a.name_val.localeCompare(b.name_val);
    });
    for (var i = 0; i < objs.length; i++) {
        if (objs[i].objType === 'icon' || objs[i].objType === 'shape')
            res += ';' + objs[i]._id + ':' + objs[i].name_val.split('\n')[0].replace(':','').replace(';','');
    }
    return res;
}

function insertRow() {
    bootbox.dialog({
        message: "Username: <input type='text' id='username'><br>Permissions: <input type='text' id='permissions'><br>",
        title: "Insert New User",
        buttons: {
            confirm: {
                label: "Insert",
                className: "btn-primary",
                callback: function() {
                    console.log("Hi "+ $('#first_name').val());
                }
            },
            cancel: {
                label: 'Cancel',
                className: 'btn-danger'
            }
        }
    });
}

// READY!
$(document).ready(function() {
    $('#modal-title').text('Please wait...!');
    $('#modal-body').html('<p>Loading COP, please wait...</p><img src="images/loading.gif"/>');
    $('#modal-footer').html('');
    //$('#modal').modal('show');

    startTime();
    notifSound = new Audio('sounds/knock.mp3');
    $('.modal-dialog').draggable({ handle: '.modal-header' });
    $('.modal-content').resizable({ minHeight: 153, minWidth: 300});
    // ---------------------------- SOCKETS ----------------------------------
    if (location.protocol === 'https:') {
        socket = new WebSocket('wss://' + window.location.host + '/mcscop/');
        wsdb = new WebSocket('wss://' + window.location.host + '/mcscop/');
    } else {
        socket = new WebSocket('ws://' + window.location.host + '/mcscop/');
        wsdb = new WebSocket('ws://' + window.location.host + '/mcscop/');
    }
    shareDBConnection = new ShareDB.Connection(wsdb);
    wsdb.onopen = function() {
        wsdb.send(JSON.stringify({act: 'stream', arg: ''}));
    };

    // ---------------------------- DIAGRAM SOCKET STUFF ----------------------------------
    socket.onopen = function() {
        setTimeout(function() {
            $('#modal').modal('hide');
        }, 1000);
        $('#modal').modal('hide');
        socket.pingInterval = setInterval(function ping() {
            socket.send(JSON.stringify({ act: 'ping', arg: '', msgId: msgHandler() }));
        }, 10000);
        setTimeout(function() {
            console.log('connect');
            console.log('joining mission: ' + mission_id);
            socket.send(JSON.stringify({ act:'join', arg: {mission_id: mission_id}, msgId: msgHandler() }));
        }, 100);
    };
    
    // message handler
    socket.onmessage = function(msg) {
        msg = JSON.parse(msg.data);
        switch(msg.act) {
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

            // getters
            case 'join':
                // objects
                objectsLoaded = [];
                var objects = msg.arg.objects;
                for (var o in objects) {
                    if (objects[o].type === 'icon' && SVGCache[objects[o].image] === undefined && objects[o].image !== undefined && objects[o].image !== null) {
                        SVGCache[objects[o].image] = null;
                        objectsLoaded.push(false);
                        getIcon(objects[o].image);
                    }
                }
                checkIfShapesCached(objects);

                // users
                userSelect = userSelect.concat(msg.arg.users);
                settingsTabulator.setData(msg.arg.userSettings);

                // notes
                createNotesTree(msg.arg.notes);

                // chat
                addChatMessage(msg.arg.chats, true);

                break;

            // chat
            case 'bulk_chat':
                addChatMessage(msg.arg, true);
                break;
            case 'chat':
                addChatMessage(msg.arg);
                break;

            // files
            case 'update_files':
                $('#files').jstree('refresh');
                break;

            // notes
            case 'insert_note':
                $('#notes').jstree(true).create_node('#', msg.arg);
                break;
            case 'rename_note':
                var node = $('#notes').jstree(true).get_node(msg.arg.id, true);
                if (node)
                    $('#notes').jstree(true).rename_node(node, msg.arg.name);
                break;
            case 'delete_note':
                var node = $('#notes').jstree(true).get_node(msg.arg.id, true);
                if (node)
                    $('#notes').jstree(true).delete_node(node);
                break;

            // users
            case 'update_user_setting':
                var e = msg.arg;
                //$('#users').jqGrid('setRowData', e._id, e);
                break;

            case 'insert_user_setting':
                var e = msg.arg;
                //$('#users').jqGrid('addRowData', e._id, e, 'last');
                //$('#users').jqGrid('sortGrid', 'event_time', false, 'asc');
                break;

            case 'delete_user_setting':
                var e = msg.arg;
                //$('#users').jqGrid('delRowData', e._id);
                break;

            // objects
            case 'change_object':
                var o = msg.arg;
                var selected = '';
                for (var i = 0; i < canvas.getObjects().length; i++) {
                    if (canvas.item(i)._id === o._id) {
                        var to = canvas.item(i);
                        if (to === canvas.getActiveObject()) {
                            updatingObject = true;
                            selected = 'single';
                            if (canvas.getActiveObjects().length > 1) {
                                selected = 'group';
                                canvas.getActiveObjects().remove(to);
                            }
                        }
                        if (o.type === 'icon') {
                            var old_children = [];
                            for (var k = 0; k < to.children.length; k++) {
                                if (to.children[k].objType ===  'link')
                                    old_children.push(to.children[k]);
                                if (to.children[k].objType === 'name')
                                    canvas.remove(to.children[k]);
                            }
                            canvas.remove(to);
                            cb = function() {
                                for (k = 0; k < old_children.length; k++) {
                                    updateLink(old_children[k]);
                                }
                            }
                            addObjectToCanvas(o, selected, cb);
                            canvas.requestRenderAll();
                        } else if (o.type === 'shape' || o.type === 'link') {
                            setObjectLock(canvas.item(i), o.locked);
                            if (o.type === 'link' && o.stroke_color === '') // don't let links disappear
                                o.stroke_color = '#000000';
                            if (canvas.item(i).name_val !== o.name) {
                                console.log('renaming');
                                canvas.item(i).name_val = o.name;
                                for (var k = 0; k < to.children.length; k++) {
                                    if (canvas.item(i).children[k].objType === 'name') {
                                        canvas.item(i).children[k].set('text', o.name);
                                    }
                                }
                            }
                            canvas.item(i).set('stroke', o.stroke_color);
                            canvas.item(i).set('fill', o.fill_color);
                            canvas.item(i).set('dirty', true);
                            canvas.requestRenderAll();
                        }
                        updatingObject = false;
                        break;
                    }
                }
                break;

           case 'move_object':
                for (var h = 0; h < msg.arg.length; h++) {
                    var o = msg.arg[h];
                    for (var i = 0; i < canvas.getObjects().length; i++) {
                        if (canvas.item(i)._id == o._id) {
                            var obj = canvas.item(i);
                            obj.dirty = true;

                            if (obj.objType !== 'link') {
                                obj.set('angle', o.rot);
                                if (o.type === 'shape') {
                                    obj.set('width', o.scale_x);
                                    obj.set('height', o.scale_y);
                                } else if (o.type === 'icon') {
                                    obj.set('scaleX', o.scale_x);
                                    obj.set('scaleY', o.scale_y);
                                }
                                var tmod = 0;
                                var lmod = 0;
                                if (canvas.getActiveObjects().length > 1 && canvas.getActiveObjects().indexOf(obj) > -1) {
                                    canvas.getActiveObject().removeWithUpdate(obj);
                                }
                                obj.set({left: o.x, top: o.y});
                                for (var j = 0; j < obj.children.length; j++) {
                                    if (obj.children[j].objType === 'name') {
                                        obj.children[j].set('top', tmod + obj.top + obj.height * obj.scaleY + 4);
                                        obj.children[j].set('left', lmod + obj.left + (obj.width * obj.scaleX)/2);
                                        obj.children[j].setCoords();
                                    } else if (obj.children[j].objType === 'link') {
                                        drawLink(obj.children[j]);
                                    }
                                }
                                obj.setCoords();
                            }
                            if (o.z !== undefined && i !== o.z*2) {
                                if (i < o.z*2) {
                                    obj.moveTo((o.z)*2 + 1);
                                    for (var k = 0; k < obj.children.length; k++) {
                                        if (obj.children[k].objType === 'name') {
                                            obj.children[k].moveTo(canvas.getObjects().indexOf(obj));
                                        }
                                    }
                                } else {
                                    obj.moveTo(o.z*2);
                                    for (var k = 0; k < obj.children.length; k++) {
                                        if (obj.children[k].objType === 'name') {
                                            obj.children[k].moveTo(canvas.getObjects().indexOf(obj)+1);
                                        }
                                    }
                                }
                            }
                            break;
                        }
                    }
                }
                canvas.requestRenderAll();
                updateMinimapBg();
                break;

            case 'insert_object':
                for (var h = 0; h < msg.arg.length; h++) {
                    var o = msg.arg[h];
                    addObjectToCanvas(o, false);
                }
                updateMinimapBg();
                break;

            case 'delete_object':
                var _id = msg.arg;
                for (var i = 0; i < canvas.getObjects().length; i++) {
                    if (canvas.item(i)._id == _id) {
                        var object = canvas.item(i);
                        if (canvas.item(i).children !== undefined) {
                            for (var k = 0; k < object.children.length; k++) {
                                if (object.children[k].objType === 'name')
                                    canvas.remove(object.children[k]);
                            }
                        }
                        if (canvas.getActiveObjects().indexOf(object) > 1)
                            canvas.getActiveObject().removeWithUpdate(object);
                        canvas.remove(object);
                        break;
                    }
                }
                updateMinimapBg();
                canvas.requestRenderAll();
                break;
        }
    };

    socket.onclose = function() {
        canvas.clear();
        canvas.requestRenderAll();
        clearInterval(socket.pingInterval);
        $('#modal-close').hide();
        $('#modal-title').text('Attention!');
        $('#modal-body').html('<p>Connection lost! Please refesh the page to retry!</p>');
        $('#modal-footer').html('');
        $('#modal-content').removeAttr('style');
        $('#modal-content').removeClass('modal-details');
        $('#modal').removeData('bs.modal').modal({backdrop: 'static', keyboard: false});
    };

    // ---------------------------- IMAGE PICKER ----------------------------------
    $('#propObjectGroup').tabs({
        beforeActivate: function(e, u) {
            $('#propType').val(u.newPanel.attr('id').split('-')[1]);
            if ($('#propType').val() === 'link')
                $('#propFillColorSpan').hide();
            else
                $('#propFillColorSpan').show();
        }
    });
    $.each(['icon','shape','link'], function(i, v) {
        $('#prop-' + v).imagepicker({
            hide_select : true,
            initialized: function() {
                if (!diagram_rw)
                    $("#propObjectGroup").find("div").unbind('click');
            },
            selected : function() {
                if (!diagram_rw)
                    return;
                if (canvas.getActiveObject() !== null && canvas.getActiveObject() !== undefined && (canvas.getActiveObject().objType === 'icon' || canvas.getActiveObject().objType === 'shape')) {
                    var obj = canvas.getActiveObject();
                    var oldZ = canvas.getObjects().indexOf(canvas.getActiveObject());
                    obj.image = $(this).val().replace('.png','.svg');
                    var type = $(this).val().split('-')[2];
                    if (obj.objType !== type)
                        return;
                    updatingObject = true;
                    changeObject(obj);
                    updatingObject = false;
                } else {
                    var type = $(this).val().split('-')[2];
                    $('#propType').val(type)
                }
            }
        });
    });

    // ---------------------------- USERS TABLE ----------------------------------   
    // bottom table tabs
    console.log('here');
    $('#chatTab').click(function() { toggleTable('chat'); });
    $('#settingsTab').click(function() { toggleTable('settings'); });

     $('#insertRow').click(function() { insertRow(); });

    settingsTabulator = new Tabulator("#settingsTable", {
        layout: "fitColumns",
        columns: [
            { title: '_id', field: '_id' },
            { title: 'User ID', field: 'user_id' },
            { title: 'Username', field: 'username', editor: 'input' },
            { title: 'Permissions', field: 'permissions', editor: 'select', editorParams: { none: 'None', all:'All', manage_users:'Manage Users', modify_diagram: 'Modify Diagram', modify_notes: 'Modify Notes', modify_details: 'Modify Details', modify_files: 'Modify Files' } }
        ]
    });

    // ---------------------------- BUTTONS ----------------------------------
    $('#zoomInButton').click(function() { zoomIn(); });
    $('#zoomOutButton').click(function() { zoomOut(); });
    $('#objectSearch').change(function() { objectSearch(this.value) });
    $('#nextObjectSearch').click(function() { nextObjectSearch(); });
    $('#prevObjectSearch').click(function() { prevObjectSearch(); });
    $('#downloadEventsButton').click(function() { downloadEvents(); });
    $('#downloadDiagramButton').click(function() { downloadDiagram(this); });
    $('#downloadOpnotesButton').click(function() { downloadOpnotes(); });
    
    // ---------------------------- CHAT ----------------------------------
    $('.channel').click(function(e) {
        var c = e.target.id.split('-')[1];
        if ($('#' + activeChannel)[0].scrollHeight - $('#' + activeChannel).scrollTop() === $('#' + activeChannel).outerHeight())
            chatPosition[activeChannel] = 'bottom';
        else
            chatPosition[activeChannel] = $('#' + activeChannel).scrollTop();
        $('.channel-pane').hide();
        $('.channel').removeClass('channelSelected');
        $('#' + c).show();
        unreadMessages[c] = 0;
        $('#unread-' + c).hide();
        $('#chatTab').css('background-color', '');
        if (!chatPosition[c] || chatPosition[c] === 'bottom')
            $('#' + c).scrollTop($('#' + c)[0].scrollHeight);
        $('#channel-' + c).addClass('channelSelected');
        activeChannel = c;
    });

    $('#chatTab').click(function(e) {
        unreadMessages[activeChannel] = 0;
        $('#unread-' + activeChannel).hide();
        $('#chatTab').css('background-color', '');
    });

    // ---------------------------- WINDOW MANAGER ----------------------------------
    windowManager = new WindowManager({
        container: "#windowPane",
        windowTemplate: $('#details_template').html()
    });

    // ---------------------------- MISC ----------------------------------
    $('#diagram').mousedown(startPan);

    $('[name="propFillColor"]').paletteColorPicker({
        colors: [
            {'#000000': '#000000'},
            {'#808080': '#808080'},
            {'#c0c0c0': '#c0c0c0'},
            {'#ffffff': '#ffffff'},
            {'#800000': '#800000'},
            {'#ff0000': '#ff0000'},
            {'#808000': '#808000'},
            {'#ffff00': '#ffff00'},
            {'#008000': '#008000'},
            {'#00ff00': '#00ff00'},
            {'#008080': '#008080'},
            {'#00ffff': '#00ffff'},
            {'#000080': '#000080'},
            {'#0000ff': '#0000ff'},
            {'#800080': '#800080'},
            {'#ff00ff': '#ff00ff'}  
        ],
        clear_btn: null,
        position: 'upside',
        timeout: 2000,
        close_all_but_this: true,
        onchange_callback: function (color) {
            if (color !== $('#propFillColor').val())
                updatePropFillColor(color);
        }
    });
    $('[name="propStrokeColor"]').paletteColorPicker({
        colors: [
            {'#000000': '#000000'},
            {'#808080': '#808080'},
            {'#c0c0c0': '#c0c0c0'},
            {'#ffffff': '#ffffff'},
            {'#800000': '#800000'},
            {'#ff0000': '#ff0000'},
            {'#808000': '#808000'},
            {'#ffff00': '#ffff00'},
            {'#008000': '#008000'},
            {'#00ff00': '#00ff00'},
            {'#008080': '#008080'},
            {'#00ffff': '#00ffff'},
            {'#000080': '#000080'},
            {'#0000ff': '#0000ff'},
            {'#800080': '#800080'},
            {'#ff00ff': '#ff00ff'}  
        ],
        position: 'upside',
        timeout: 2000, // default -> 2000
        close_all_but_this: true,
        onchange_callback: function (color) {
            if (color !== $('#propStrokeColor').val())
                updatePropStrokeColor(color);
        }
    });
    
    // make the diagram resizable
    $("#diagramJumbo").resizable({ handles: 's', minHeight: 350 });
    $("#bottomJumbo").resizable({ handles: 's', minHeight: 350 });
    $("#toolbarBody").resizable({ handles: 'w', maxWidth: $('#diagramJumbo').width()-60 });

    // resize event to resize canvas and toolbars
    $('#diagramJumbo').on('resize', function(event, ui) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            settings[activeToolbar] = Math.round($('#toolbarBody').width());
            settings.diagram = Math.round($('#diagramJumbo').height());
            updateSettings();
            resizeCanvas();
        }, 100);
    });

    // on resize, resize the canvas
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            resizeCanvas();
        }, 100);
    }, false);
    
    // capture enter key in chat input bar
    $("#messageInput").keypress(function (e) {
        var key = e.charCode || e.keyCode || 0;
        if (key === $.ui.keyCode.ENTER) {
            sendChatMessage($("#messageInput").val(), activeChannel);
            $("#messageInput").val('');
        }
    });

    // capture keys
    window.addEventListener("keydown",function (e) {
        // copy
        if (lastClick === canvas.upperCanvasEl) {
            if (e.ctrlKey && (e.keyCode === 'c'.charCodeAt(0) || e.keyCode === 'C'.charCodeAt(0))) {
                canvasClipboard = [];
                o = canvas.getActiveObjects();

                var x = 0;
                var y = 0;
                           
                for (var i = 0; i < o.length; i++) {
                    if (o.length === 1) {
                        x = 0 - o[i].width/2;
                        y = 0 - o[i].height/2;
                    } else {
                        x = o[i].left;
                        y = o[i].top;
                    }
                    canvasClipboard.push({ _id: o[i]._id, x: x, y: y, z: Math.round(canvas.getObjects().indexOf(o[i] / 2)) });
                }
            
            // paste
            } else if (e.ctrlKey && (e.keyCode === 'v'.charCodeAt(0) || e.keyCode === 'V'.charCodeAt(0))) {
                if (canvasClipboard.length > 0)
                    pasteObjects();

            // delete
            } else if (e.keyCode === 46) {
                if (canvas.getActiveObject())
                   deleteObjectConfirm();

            // arrows
            } else if (e.keyCode >= 37 && e.keyCode <= 40 && canvas.getActiveObject()) {
                var o = canvas.getActiveObject();
                if (objectMovingTimer)
                    window.clearTimeout(objectMovingTimer);
                objectMovingTimer = setTimeout(function() {
                    objectModified(o);
                }, 1000);
                switch (e.keyCode) {
                    case 37:
                        o.left -= 1;
                        break;
                    case 38:
                        o.top -= 1;
                        break;
                    case 39:
                        o.left += 1;
                        break;
                    case 40:
                        o.top += 1;
                        break;
                }
                objectMoving(o, 0);
                o.setCoords();
                canvas.requestRenderAll();

            // search (ctrl + f)
            } else if (e.keyCode === 114 || (e.ctrlKey && e.keyCode === 70)) { 
                e.preventDefault();
                if (!$('#objectSearchBar').is(':visible')) {
                    $('#objectSearchBar').show().css('display', 'table');
                    $('#objectSearch').focus();
                } else {
                    $('#foundCount').hide();
                    $('#objectSearchBar').hide();
                    $('#objectSearch').val('');
                }
            }
        }
    })
    $('#diagramJumbo').focus();
    // load settings from cookie
    loadSettings();
    resizeCanvas();
});