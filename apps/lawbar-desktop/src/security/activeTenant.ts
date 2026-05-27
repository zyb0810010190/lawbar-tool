let activeTenantId = "default-tenant";

export function getActiveTenantId(): string {
  return activeTenantId;
}

export function _setActiveTenantIdForTesting(value: string): void {
  activeTenantId = value;
}
