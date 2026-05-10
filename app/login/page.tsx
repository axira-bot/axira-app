"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useI18n } from "@/lib/context/I18nContext";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Label,
  Text,
  TextField,
} from "@heroui/react";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message ?? t("login.invalidCredentials"));
      return;
    }
    router.replace("/dashboard");
  };

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-4"
      style={{ background: "var(--color-bg)" }}
    >
      <div className="absolute right-4 top-4">
        <LocaleSwitcher />
      </div>
      <Card.Root className="w-full max-w-md shadow-lg">
        <Card.Header className="flex flex-col gap-1 pb-0">
          <Card.Title className="text-2xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-heading)" }}>
            {t("login.title")}
          </Card.Title>
          <Card.Description className="text-sm font-medium text-[hsl(var(--heroui-primary))]">
            {t("login.signIn")}
          </Card.Description>
        </Card.Header>
        <Card.Content className="pt-6">
          <Form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <TextField name="email" type="email" value={email} onChange={setEmail} isRequired>
              <Label className="text-xs font-medium text-default-500">{t("login.email")}</Label>
              <Input
                placeholder={t("login.emailPlaceholder")}
                autoComplete="email"
                className="w-full"
              />
            </TextField>
            <TextField name="password" type="password" value={password} onChange={setPassword} isRequired>
              <Label className="text-xs font-medium text-default-500">{t("login.password")}</Label>
              <Input
                placeholder="••••••••"
                autoComplete="current-password"
                className="w-full"
              />
            </TextField>
            {error ? (
              <Alert.Root status="danger">
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert.Root>
            ) : null}
            <Button type="submit" variant="primary" fullWidth isDisabled={loading}>
              {loading ? t("login.signingIn") : t("login.signInButton")}
            </Button>
          </Form>
        </Card.Content>
        <Card.Footer className="pt-0">
          <Text className="w-full text-center text-xs text-default-500">
            {t("login.accountsCreatedByAdmin")}
          </Text>
        </Card.Footer>
      </Card.Root>
    </div>
  );
}
