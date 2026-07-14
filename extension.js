import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class ClipboardHistoryExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._history = [];
        this._lastText = '';

        Main.wm.addKeybinding(
            'toggle-clipboard-history',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.ALL,
            () => this._togglePopup()
        );

        this._clipboard = St.Clipboard.get_default();
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._checkClipboard();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _checkClipboard() {
        this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (clipboard, text) => {
            if (!text || text === this._lastText)
                return;

            this._lastText = text;
            this._history.unshift(text);
            if (this._history.length > 20)
                this._history.pop();
        });
    }

    _togglePopup() {
        if (this._popup)
            this._closePopup();
        else
            this._openPopup();
    }

    _openPopup() {
        this._previousWindow = global.display.focus_window;

        this._popup = new St.BoxLayout({
            vertical: true,
            reactive: true,
            style_class: 'clipboard-history-popup',
        });

        const header = new St.BoxLayout({style_class: 'clipboard-history-header'});
        const title = new St.Label({
            text: 'Clipboard',
            x_expand: true,
            style_class: 'clipboard-history-title',
        });
        const closeButton = new St.Button({
            style_class: 'clipboard-history-close',
            label: '×',
            reactive: true,
            track_hover: true,
        });
        closeButton.connect('clicked', () => this._closePopup());
        header.add_child(title);
        header.add_child(closeButton);
        this._popup.add_child(header);

        this._entriesBox = new St.BoxLayout({vertical: true});
        this._popup.add_child(this._entriesBox);
        this._renderEntries();

        Main.layoutManager.addChrome(this._popup);
        this._positionAtCursor();
    }

    _renderEntries() {
        this._entriesBox.destroy_all_children();

        if (this._history.length === 0) {
            this._entriesBox.add_child(new St.Label({
                text: '(empty)',
                style_class: 'clipboard-history-item',
            }));
            return;
        }

        for (const text of this._history) {
            const row = new St.BoxLayout({style_class: 'clipboard-history-row'});

            const button = new St.Button({
                style_class: 'clipboard-history-item',
                label: text.length > 60 ? `${text.slice(0, 60)}…` : text,
                x_expand: true,
                reactive: true,
                track_hover: true,
            });
            button.connect('clicked', () => this._selectEntry(text));

            const deleteButton = new St.Button({
                style_class: 'clipboard-history-delete',
                label: '🗑',
                reactive: true,
                track_hover: true,
            });
            deleteButton.connect('clicked', () => this._deleteEntry(text));

            row.add_child(button);
            row.add_child(deleteButton);
            this._entriesBox.add_child(row);
        }
    }

    _deleteEntry(text) {
        const index = this._history.indexOf(text);
        if (index !== -1)
            this._history.splice(index, 1);
        this._renderEntries();
    }

    _positionAtCursor() {
        const monitor = Main.layoutManager.currentMonitor;

        const [, natWidth] = this._popup.get_preferred_width(-1);
        const [, natHeight] = this._popup.get_preferred_height(natWidth);

        const [pointerX, pointerY] = global.get_pointer();

        const x = Math.max(monitor.x, Math.min(pointerX + 12, monitor.x + monitor.width - natWidth));
        const y = Math.max(monitor.y, Math.min(pointerY + 12, monitor.y + monitor.height - natHeight));

        this._popup.set_position(x, y);
    }

    _selectEntry(text) {
        if (this._history.includes(text))
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        this._closePopup();

        if (this._pasteTimeoutId)
            GLib.source_remove(this._pasteTimeoutId);

        this._pasteTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._pasteTimeoutId = null;
            this._pasteText();
            return GLib.SOURCE_REMOVE;
        });
    }

    _pasteText() {
        if (this._previousWindow)
            this._previousWindow.activate(global.get_current_time());

        if (!this._virtualKeyboard) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._virtualKeyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        }

        const now = GLib.get_monotonic_time();
        this._virtualKeyboard.notify_keyval(now, Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
        this._virtualKeyboard.notify_keyval(now, Clutter.KEY_v, Clutter.KeyState.PRESSED);
        this._virtualKeyboard.notify_keyval(now, Clutter.KEY_v, Clutter.KeyState.RELEASED);
        this._virtualKeyboard.notify_keyval(now, Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
    }

    _closePopup() {
        if (!this._popup)
            return;

        Main.layoutManager.removeChrome(this._popup);
        this._popup.destroy();
        this._popup = null;
        this._entriesBox = null;
    }

    disable() {
        this._closePopup();

        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = null;
        }
        if (this._pasteTimeoutId) {
            GLib.source_remove(this._pasteTimeoutId);
            this._pasteTimeoutId = null;
        }
        Main.wm.removeKeybinding('toggle-clipboard-history');

        this._settings = null;
        this._history = null;
        this._clipboard = null;
        this._virtualKeyboard = null;
        this._previousWindow = null;
    }
}
