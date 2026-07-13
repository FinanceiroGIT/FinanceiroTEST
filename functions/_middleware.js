export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  // libera o login e qualquer arquivo estatico (css/js/imagens) sem exigir cookie
  const rotasLivres = ['/login.html', '/login', '/assets/'];
  if (rotasLivres.some((r) => url.pathname.startsWith(r))) {
    return next();
  }

  const cookie = request.headers.get('cookie') || '';
  if (!cookie.includes('logado=1')) {
    return Response.redirect(`${url.origin}/login.html`, 302);
  }

  return next();
}