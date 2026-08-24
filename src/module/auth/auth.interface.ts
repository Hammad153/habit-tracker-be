export interface UserPayload {
  id: string;
  name: string;
  email: string;
  role: string;
  companyId?: string;
  company?: {
    id: string;
    name: string;
  };
}

/** Verified JWT payload shape (Phase 3.8 adds the server-issued role). */
export interface JwtRolePayload {
  sub: string;
  email: string;
  role?: 'USER' | 'ADMIN'; // absent in pre-3.8 tokens → resolves to USER
  token_type?: 'access' | 'refresh';
}
