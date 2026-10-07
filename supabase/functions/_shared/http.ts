export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

export const fail = (status: number, message: string) => json({ message }, status);

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Wraps a handler with CORS preflight + uniform error responses.
export const serve = (handler: (req: Request) => Promise<Response>) =>
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return fail(405, 'Method not allowed');
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      console.error(err);
      return fail(500, 'Internal error');
    }
  });

export const readJson = async (req: Request): Promise<Record<string, unknown>> => {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
};
