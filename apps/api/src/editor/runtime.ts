// apps/api/src/editor/runtime.ts — Browser-side editing runtime, exported as a string.
// This file runs in Node (server-side) and simply exports the script text so the
// route handler can inject it into served HTML. The template literal below is
// plain browser JavaScript — it does NOT execute in Node.
//
// The injected script:
//   1. Stamps data-abw-id on any elements that don't already have one.
//   2. Adds hover outline (purple) on mouseenter/mouseleave.
//   3. On click: if the element is a text leaf, makes it contentEditable; on blur,
//      fires an edit_text postMessage. Otherwise shows a floating toolbar with
//      Edit Text / Edit Style / Delete / Duplicate buttons.
//   4. All events go to parent via window.parent.postMessage for the React shell.

export const EDITOR_RUNTIME: string = /* language=javascript */ `
(function () {
  'use strict';

  // ── ID stamping ────────────────────────────────────────────────────────────
  var _counter = 0;
  var SKIP_TAGS = new Set(['HTML', 'HEAD', 'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE']);

  function stampAll() {
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (!el.hasAttribute('data-abw-id')) {
        el.setAttribute('data-abw-id', String(_counter++));
      } else {
        // Keep counter in sync with pre-stamped IDs
        var existing = parseInt(el.getAttribute('data-abw-id'), 10);
        if (!isNaN(existing) && existing >= _counter) {
          _counter = existing + 1;
        }
      }
    }
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  var toolbar = null;
  var toolbarTimer = null;
  var activeEl = null;

  function removeToolbar() {
    if (toolbar && toolbar.parentNode) {
      toolbar.parentNode.removeChild(toolbar);
    }
    toolbar = null;
    activeEl = null;
    if (toolbarTimer) { clearTimeout(toolbarTimer); toolbarTimer = null; }
  }

  function resetToolbarTimer() {
    if (toolbarTimer) clearTimeout(toolbarTimer);
    toolbarTimer = setTimeout(removeToolbar, 3000);
  }

  function send(action, selector, payload) {
    window.parent.postMessage({
      abwAction: true,
      action: action,
      selector: selector,
      payload: payload || {}
    }, '*');
  }

  function showStyleForm(el, abwId, rect) {
    removeToolbar();

    var form = document.createElement('div');
    form.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'background: #1e1e2e',
      'border: 1px solid #6c63ff',
      'border-radius: 8px',
      'padding: 10px 14px',
      'font-family: system-ui, sans-serif',
      'font-size: 12px',
      'color: #cdd6f4',
      'box-shadow: 0 4px 20px rgba(0,0,0,0.5)',
      'min-width: 220px',
    ].join(';');

    var top = Math.min(rect.bottom + 8, window.innerHeight - 200);
    var left = Math.min(rect.left, window.innerWidth - 240);
    form.style.top  = top + 'px';
    form.style.left = left + 'px';

    var fields = [
      { label: 'Background', prop: 'background-color', type: 'color' },
      { label: 'Text color',  prop: 'color',            type: 'color' },
      { label: 'Font size',   prop: 'font-size',        type: 'text', placeholder: 'e.g. 16px' },
      { label: 'Padding',     prop: 'padding',          type: 'text', placeholder: 'e.g. 8px 12px' },
    ];

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00d7';
    closeBtn.style.cssText = 'float:right;background:none;border:none;color:#cdd6f4;cursor:pointer;font-size:16px;line-height:1;padding:0';
    closeBtn.onclick = removeToolbar;
    form.appendChild(closeBtn);

    var title = document.createElement('div');
    title.textContent = 'Edit Style';
    title.style.cssText = 'font-weight:600;margin-bottom:8px;color:#cba6f7';
    form.appendChild(title);

    for (var f = 0; f < fields.length; f++) {
      (function(field) {
        var row = document.createElement('div');
        row.style.marginBottom = '6px';

        var lbl = document.createElement('label');
        lbl.textContent = field.label + ': ';
        lbl.style.display = 'inline-block';
        lbl.style.width = '90px';

        var inp = document.createElement('input');
        inp.type = field.type;
        if (field.placeholder) inp.placeholder = field.placeholder;
        inp.style.cssText = 'background:#313244;border:1px solid #45475a;color:#cdd6f4;border-radius:4px;padding:2px 4px;width:100px';

        inp.addEventListener('change', function() {
          var val = inp.value.trim();
          if (val) {
            send('edit_style', abwId, { property: field.prop, value: val });
          }
        });

        row.appendChild(lbl);
        row.appendChild(inp);
        form.appendChild(row);
      })(fields[f]);
    }

    document.body.appendChild(form);
    toolbar = form;
    form.addEventListener('mousemove', resetToolbarTimer);
    resetToolbarTimer();
  }

  function showToolbar(el, abwId, rect) {
    removeToolbar();
    activeEl = el;

    var bar = document.createElement('div');
    bar.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'background: #1e1e2e',
      'border: 1px solid #6c63ff',
      'border-radius: 6px',
      'padding: 4px 6px',
      'display: flex',
      'gap: 4px',
      'align-items: center',
      'font-family: system-ui, sans-serif',
      'font-size: 11px',
      'box-shadow: 0 4px 16px rgba(0,0,0,0.5)',
    ].join(';');

    var top  = Math.max(4, rect.top - 38);
    var left = Math.min(rect.left, window.innerWidth - 280);
    bar.style.top  = top + 'px';
    bar.style.left = left + 'px';

    function btn(label, onClick) {
      var b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = [
        'background: #313244',
        'border: 1px solid #45475a',
        'color: #cdd6f4',
        'border-radius: 4px',
        'padding: 3px 8px',
        'cursor: pointer',
        'font-size: 11px',
        'white-space: nowrap',
      ].join(';');
      b.addEventListener('mouseenter', function() { b.style.background = '#45475a'; });
      b.addEventListener('mouseleave', function() { b.style.background = '#313244'; });
      b.addEventListener('click', function(e) { e.stopPropagation(); onClick(); });
      return b;
    }

    // Edit Text — make contentEditable
    bar.appendChild(btn('Edit Text', function() {
      removeToolbar();
      el.contentEditable = 'true';
      el.focus();
      el.style.outline = '2px solid #6c63ff';

      function onBlur() {
        el.contentEditable = 'false';
        el.style.outline = '';
        send('edit_text', abwId, { newText: el.innerText });
        el.removeEventListener('blur', onBlur);
      }
      el.addEventListener('blur', onBlur);
    }));

    // Edit Style
    bar.appendChild(btn('Edit Style', function() {
      showStyleForm(el, abwId, rect);
    }));

    // Delete
    bar.appendChild(btn('Delete', function() {
      removeToolbar();
      send('delete_element', abwId, {});
    }));

    // Duplicate
    bar.appendChild(btn('Duplicate', function() {
      removeToolbar();
      send('duplicate_element', abwId, {});
    }));

    // Close
    var closeBtn = btn('\u00d7', removeToolbar);
    closeBtn.style.fontWeight = 'bold';
    closeBtn.style.padding = '3px 6px';
    bar.appendChild(closeBtn);

    document.body.appendChild(bar);
    toolbar = bar;
    bar.addEventListener('mousemove', resetToolbarTimer);
    resetToolbarTimer();
  }

  // ── Hover ──────────────────────────────────────────────────────────────────
  function onMouseEnter(e) {
    var el = e.target;
    if (!el || SKIP_TAGS.has(el.tagName)) return;
    if (el.contentEditable === 'true') return;
    el.__abwOutlinePrev = el.style.outline;
    el.style.outline = '2px solid #6c63ff';
  }

  function onMouseLeave(e) {
    var el = e.target;
    if (!el || SKIP_TAGS.has(el.tagName)) return;
    if (el.contentEditable === 'true') return;
    el.style.outline = el.__abwOutlinePrev || '';
  }

  // ── Click ──────────────────────────────────────────────────────────────────
  function isTextLeaf(el) {
    // A text leaf: has no child Element nodes, only text/comment children
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 1) return false; // ELEMENT_NODE
    }
    return true;
  }

  function onClick(e) {
    var el = e.target;
    if (!el || SKIP_TAGS.has(el.tagName)) return;
    if (el === toolbar || (toolbar && toolbar.contains(el))) return;

    e.stopPropagation();

    var abwId = el.getAttribute('data-abw-id');
    if (!abwId) return;

    var rect = el.getBoundingClientRect();

    if (isTextLeaf(el)) {
      // Make directly editable
      el.contentEditable = 'true';
      el.focus();
      el.style.outline = '2px solid #6c63ff';

      function onBlur() {
        el.contentEditable = 'false';
        el.style.outline = '';
        send('edit_text', abwId, { newText: el.innerText });
        el.removeEventListener('blur', onBlur);
      }
      el.addEventListener('blur', onBlur);
    } else {
      showToolbar(el, abwId, rect);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    stampAll();

    document.addEventListener('mouseenter', onMouseEnter, true);
    document.addEventListener('mouseleave', onMouseLeave, true);
    document.addEventListener('click',      onClick,      true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
