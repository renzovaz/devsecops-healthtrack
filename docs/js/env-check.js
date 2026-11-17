// Script clássico (não-módulo): roda mesmo quando o navegador bloqueia os módulos ES (file://).
// Avisa quando a página é aberta do jeito errado. Web Crypto exige HTTPS ou localhost.
(function () {
  'use strict';
  var box = document.getElementById('env-warning');
  if (!box) return;
  var msg = '';
  if (location.protocol === 'file:') {
    msg = 'Aberto como arquivo (file://): os módulos JavaScript e as demos não funcionam assim. Use o GitHub Pages (HTTPS) ou rode “npm run serve” e abra http://localhost:8080.';
  } else if (!window.isSecureContext || !(window.crypto && window.crypto.subtle)) {
    msg = 'Esta página foi aberta em ' + location.host + ' sem HTTPS: o navegador desativa o Web Crypto e o cliente de API não funciona. Use o GitHub Pages (HTTPS) ou http://localhost.';
  }
  if (msg) {
    box.textContent = msg;
    box.hidden = false;
  }
})();
