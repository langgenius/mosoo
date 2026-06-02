export interface CompanyForm {
  apiBase: string;
  apiKey: string;
  id: string | null;
  isDefault: boolean;
  name: string;
  vendorId: string;
}

export interface PersonalForm {
  apiBase: string;
  apiKey: string;
  label: string;
  vendorId: string;
}

export const EMPTY_COMPANY_FORM: CompanyForm = {
  apiBase: "",
  apiKey: "",
  id: null,
  isDefault: false,
  name: "",
  vendorId: "",
};

export const EMPTY_PERSONAL_FORM: PersonalForm = {
  apiBase: "",
  apiKey: "",
  label: "",
  vendorId: "",
};

export interface CustomProviderForm {
  apiKey: string;
  baseUrl: string;
  label: string;
  models: string[];
  visible: boolean;
}

export const EMPTY_CUSTOM_PROVIDER_FORM: CustomProviderForm = {
  apiKey: "",
  baseUrl: "",
  label: "",
  models: [""],
  visible: false,
};

export type TestConnectionState = "idle" | "running" | "success" | "failure";

export interface CustomProviderDeleteDialogState {
  label: string;
  open: boolean;
}

export const EMPTY_DELETE_DIALOG_STATE: CustomProviderDeleteDialogState = {
  label: "",
  open: false,
};
