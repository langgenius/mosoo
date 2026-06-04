export interface ShareMember {
  accountId: string;
  email: string;
  imageUrl: string | null;
  name: string;
}

export interface AvatarUser {
  avatar?: string | null;
  imageUrl?: string | null;
  name: string | null | undefined;
}

export function getAvatarUrl(user: AvatarUser): string | null {
  return user.imageUrl ?? user.avatar ?? null;
}

export function matchesMember(member: ShareMember, searchQuery: string): boolean {
  return (
    member.name.toLowerCase().includes(searchQuery) ||
    member.email.toLowerCase().includes(searchQuery)
  );
}
