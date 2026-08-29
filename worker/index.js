/**
 * Shop Web — Worker entry point.
 *
 * Session 1 is database + security only, so this file is deliberately
 * bare: it serves the (still empty) static asset directory and reserves
 * the /api/* namespace. Image upload/serve routes against the IMAGES R2
 * binding and the deleted_objects queue drain land in a later session.
 *
 * Multi-page app. assets.not_found_handling is "none", so anything that
 * matches no static file arrives here — that is where /@slug will be
 * server-rendered, OG tags and all, so a link shared to WhatsApp or
 * Facebook shows a preview image.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'not_implemented' }, { status: 501 });
    }

    return env.ASSETS.fetch(request);
  },
};
