"use client";

import { useRef, type ChangeEvent, type ReactElement } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { ApiError, type Me } from "@codply/contracts";
import { Avatar, IconButton, useToast } from "@codply/ui";
import { getServices } from "@/domain/services";
import { ME_QUERY_KEY } from "@/domain/hooks/useMe";
import { useI18n } from "@/components/i18n/I18nProvider";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 2 * 1024 * 1024;

/** `data:image/png;base64,AAAA…` → `AAAA…` (the API wants bare base64). */
function stripDataUrlPrefix(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/**
 * The profile header's xl avatar with a camera badge that uploads a
 * replacement image (E36). Only rendered on the viewer's own profile.
 */
export function AvatarUpload({
  name,
  src,
  handle,
}: {
  name: string;
  src?: string | null;
  handle: string;
}): ReactElement {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: (data_base64: string) => getServices().account.uploadAvatar(data_base64),
    onSuccess: (result: Me) => {
      queryClient.setQueryData(ME_QUERY_KEY, result);
      void queryClient.invalidateQueries({ queryKey: ["profile", handle] });
      void queryClient.invalidateQueries({ queryKey: ["feed"] });
      toast({ title: t.profile.avatarUpdated, variant: "success" });
    },
    onError: (error: unknown) => {
      toast({
        title: t.profile.avatarFailed,
        description: ApiError.isApiError(error) ? error.message : undefined,
        variant: "error",
      });
    },
  });

  const onFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = ""; // re-selecting the same file must fire again
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast({ title: t.profile.avatarWrongType, variant: "error" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: t.profile.avatarTooLarge, variant: "error" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      mutation.mutate(stripDataUrlPrefix(String(reader.result)));
    };
    // Read failures (unreadable/removed file) must not die silently — the
    // input value is already cleared above, so the same file can be re-picked.
    reader.onerror = () => toast({ title: t.profile.avatarReadFailed, variant: "error" });
    reader.onabort = () => toast({ title: t.profile.avatarReadFailed, variant: "error" });
    reader.readAsDataURL(file);
  };

  return (
    <div className="relative w-fit shrink-0">
      <Avatar name={name} src={src ?? undefined} size="xl" />
      <IconButton
        icon={Camera}
        aria-label={t.profile.changeAvatar}
        aria-busy={mutation.isPending || undefined}
        disabled={mutation.isPending}
        size="sm"
        variant="solid"
        className="absolute bottom-0 end-0 rounded-full"
        onClick={() => inputRef.current?.click()}
      />
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        data-testid="avatar-file-input"
        onChange={onFile}
      />
    </div>
  );
}
