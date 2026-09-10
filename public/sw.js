// Service worker mínimo, só o suficiente para o navegador considerar o site "instalável"
// (requisito técnico de PWA). O cache aqui é básico — melhora um pouco a velocidade de
// recarregamento, mas não é um sistema de "funciona 100% offline".

const CACHE_NAME = 'barbearia-estilo-v1';
const ARQUIVOS_PARA_CACHE = [
  '/index.html',
  '/style.css',
  '/menu.js',
  '/imagens/logo.png'
];

// Ao instalar, guarda os arquivos essenciais em cache
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARQUIVOS_PARA_CACHE))
  );
  self.skipWaiting();
});

// Ao ativar, remove caches antigos de versões anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nomes) =>
      Promise.all(
        nomes
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome))
      )
    )
  );
  self.clients.claim();
});

// Estratégia simples: tenta a rede primeiro, cai pro cache se não conseguir
// (assim, o site sempre busca dados atualizados quando há internet)
self.addEventListener('fetch', (event) => {
  // Não intercepta chamadas de API — essas sempre precisam de rede de verdade
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});