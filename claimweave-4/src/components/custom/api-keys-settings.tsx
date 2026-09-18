// @polsia:user-owned — API-key settings client island.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch } from '@/lib/api-client';
import {
  ApiKeyCreate,
  ApiKeyCreateResponse,
  type ApiKeyItem,
  ApiKeyList,
  ApiKeyRevokeResponse,
} from '@/lib/contracts/api-keys';

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.cause && typeof error.cause === 'object') {
    const cause = error.cause as { error?: unknown };
    if (typeof cause.error === 'string') return cause.error;
  }
  return fallback;
}

function applicationNameError(error: unknown) {
  if (error instanceof Error && error.cause && typeof error.cause === 'object') {
    const cause = error.cause as { errors?: { applicationName?: unknown } };
    return typeof cause.errors?.applicationName === 'string' ? cause.errors.applicationName : null;
  }
  return null;
}

export function ApiKeysSettings() {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applicationName, setApplicationName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyItem | null>(null);
  const [createdSecret, setCreatedSecret] = useState<ApiKeyCreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const loadApiKeys = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await apiFetch('/api/api-keys', { schema: ApiKeyList });
      setApiKeys(response.items);
    } catch (error) {
      setLoadError(errorMessage(error, 'Could not load your API keys.'));
    }
  }, []);

  useEffect(() => {
    void loadApiKeys();
  }, [loadApiKeys]);

  async function createApiKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    const parsed = ApiKeyCreate.safeParse({ applicationName });
    if (!parsed.success) {
      setFieldError(
        parsed.error.flatten().fieldErrors.applicationName?.[0] ?? 'Enter an application name.',
      );
      return;
    }

    setIsCreating(true);
    try {
      const response = await apiFetch('/api/api-keys', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
        schema: ApiKeyCreateResponse,
      });
      setApiKeys((current) => (current ? [response.apiKey, ...current] : [response.apiKey]));
      setCreatedSecret(response);
      setCopied(false);
      setApplicationName('');
      toast.success('API key created. Copy it now — it will not be shown again.');
    } catch (error) {
      const serverError = applicationNameError(error);
      if (serverError) setFieldError(serverError);
      else toast.error(errorMessage(error, 'Could not create your API key.'));
    } finally {
      setIsCreating(false);
    }
  }

  async function copySecret() {
    if (!createdSecret) return;
    try {
      await navigator.clipboard.writeText(createdSecret.secret);
      setCopied(true);
      toast.success('API key copied to your clipboard.');
    } catch {
      toast.error('Copy failed. Select the key and copy it manually.');
    }
  }

  async function revokeApiKey() {
    if (!pendingRevoke) return;
    setRevokingId(pendingRevoke.id);
    try {
      const response = await apiFetch(`/api/api-keys/${pendingRevoke.id}`, {
        method: 'DELETE',
        schema: ApiKeyRevokeResponse,
      });
      setApiKeys(
        (current) =>
          current?.map((apiKey) => (apiKey.id === response.apiKey.id ? response.apiKey : apiKey)) ??
          null,
      );
      setPendingRevoke(null);
      toast.success('API key revoked.');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not revoke your API key.'));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-muted/30 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="max-w-2xl space-y-3">
          <p className="text-eyebrow text-primary">Connected applications</p>
          <h1 className="text-h1 tracking-tight">API keys</h1>
          <p className="text-body-lg text-muted-foreground">
            Create private keys for tools that connect to your Claimweave workspace. You can revoke
            a key at any time.
          </p>
        </header>

        {createdSecret && (
          <Alert className="border-primary/40 bg-primary/10 shadow-lg">
            <AlertTitle className="text-primary">Save this key now</AlertTitle>
            <AlertDescription className="space-y-4 text-foreground">
              <p>
                This is the only time we will show the full secret for{' '}
                {createdSecret.apiKey.applicationName}.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-primary/20 bg-background px-3 py-2 text-sm text-foreground">
                  {createdSecret.secret}
                </code>
                <Button type="button" variant="secondary" onClick={copySecret}>
                  {copied ? 'Copied' : 'Copy key'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreatedSecret(null)}>
                  Hide secret
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Card className="border-border/80 shadow-md">
          <CardHeader>
            <CardTitle>Create an API key</CardTitle>
            <CardDescription>
              Name the connected application so you can recognize it later.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={createApiKey}>
              <div className="flex-1 space-y-2">
                <Label htmlFor="application-name">Application name</Label>
                <Input
                  id="application-name"
                  value={applicationName}
                  onChange={(event) => setApplicationName(event.target.value)}
                  placeholder="e.g. Reporting dashboard"
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? 'application-name-error' : undefined}
                />
                {fieldError && (
                  <p id="application-name-error" className="text-sm text-destructive">
                    {fieldError}
                  </p>
                )}
              </div>
              <Button type="submit" disabled={isCreating} className="sm:min-w-32">
                {isCreating ? 'Creating…' : 'Create key'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <section className="space-y-4" aria-labelledby="existing-keys-heading">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-eyebrow text-muted-foreground">Key inventory</p>
              <h2 id="existing-keys-heading" className="text-h3">
                Your keys
              </h2>
            </div>
            {apiKeys && (
              <Badge variant="secondary">
                {apiKeys.length} {apiKeys.length === 1 ? 'key' : 'keys'}
              </Badge>
            )}
          </div>

          {loadError && (
            <Alert variant="destructive">
              <AlertTitle>Could not load keys</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                {loadError}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadApiKeys()}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {!loadError && apiKeys === null && (
            <p className="text-sm text-muted-foreground">Loading your keys…</p>
          )}
          {!loadError && apiKeys?.length === 0 && (
            <Card className="border-dashed bg-background/50">
              <CardContent className="py-12 text-center">
                <p className="font-medium">No API keys yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create one above when a connected application is ready.
                </p>
              </CardContent>
            </Card>
          )}
          {!loadError && apiKeys && apiKeys.length > 0 && (
            <Card className="overflow-hidden shadow-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Application</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apiKeys.map((apiKey) => (
                    <TableRow key={apiKey.id}>
                      <TableCell className="font-medium">{apiKey.applicationName}</TableCell>
                      <TableCell>
                        <code className="text-sm text-muted-foreground">
                          {apiKey.keyPrefix}••••••••
                        </code>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(apiKey.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={apiKey.revokedAt ? 'outline' : 'secondary'}>
                          {apiKey.revokedAt ? 'Revoked' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {!apiKey.revokedAt ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPendingRevoke(apiKey)}
                          >
                            Revoke
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground">Unavailable</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </section>
      </div>

      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => !open && setPendingRevoke(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this API key?</DialogTitle>
            <DialogDescription>
              {pendingRevoke?.applicationName} will stop working immediately. This action cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRevoke(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void revokeApiKey()}
              disabled={revokingId !== null}
            >
              {revokingId ? 'Revoking…' : 'Revoke key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
