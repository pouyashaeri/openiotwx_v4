// Themed replacements for window.alert / window.confirm, so every message matches the site.
(function () {
  var dlg, titleEl, textEl, okBtn, cancelBtn, resolveFn;
  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'themed-dialog';
    dlg.setAttribute('aria-labelledby', 'themedTitle');
    dlg.setAttribute('aria-describedby', 'themedText');
    dlg.innerHTML =
      '<div class="themed-dialog-body">' +
      '<h2 id="themedTitle"></h2><p id="themedText"></p>' +
      '<div class="themed-dialog-actions"><button type="button" class="themed-cancel"></button><button type="button" class="themed-ok"></button></div>' +
      '</div>';
    document.body.appendChild(dlg);
    titleEl = dlg.querySelector('h2');
    textEl = dlg.querySelector('p');
    okBtn = dlg.querySelector('.themed-ok');
    cancelBtn = dlg.querySelector('.themed-cancel');
    okBtn.addEventListener('click', function () { close(true); });
    cancelBtn.addEventListener('click', function () { close(false); });
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); close(false); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(false); });
  }
  function close(ok) {
    if (dlg.open) dlg.close();
    var r = resolveFn;
    resolveFn = null;
    if (r) r(ok);
  }
  function show(opts) {
    if (!dlg) build();
    if (resolveFn) close(false);
    titleEl.textContent = opts.title;
    textEl.textContent = opts.message;
    okBtn.textContent = opts.ok;
    cancelBtn.textContent = opts.cancel || '';
    cancelBtn.hidden = !opts.cancel;
    return new Promise(function (resolve) {
      resolveFn = resolve;
      dlg.showModal();
      okBtn.focus();
    });
  }
  window.themedAlert = function (message, title) {
    return show({ title: title || 'Heads up', message: String(message), ok: 'OK' }).then(function () {});
  };
  window.themedConfirm = function (message, opts) {
    opts = opts || {};
    return show({ title: opts.title || 'Are you sure?', message: String(message), ok: opts.ok || 'OK', cancel: opts.cancel || 'Cancel' });
  };
})();
