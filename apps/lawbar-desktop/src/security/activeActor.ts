let activeActorUserId = "local-user";

export function getActiveActorUserId(): string {
  return activeActorUserId;
}

export function _setActiveActorUserIdForTesting(value: string): void {
  activeActorUserId = value;
}
