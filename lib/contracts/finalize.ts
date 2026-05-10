import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { generateContractDocument } from "@/lib/contracts/generate";

export async function finalizeGeneratedDocument(args: {
  admin: SupabaseClient;
  user: User;
  mode: "agreement" | "receipt";
  dealId: string;
  paymentId?: string;
}) {
  const generated = await generateContractDocument(args.mode, {
    admin: args.admin,
    dealId: args.dealId,
    paymentId: args.paymentId,
  });
  const objectPath = generated.storagePath;
  const upload = await args.admin.storage.from("contracts").upload(objectPath, generated.buffer, {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message);

  const paymentIdReceipt = args.mode === "receipt" ? args.paymentId?.trim() : undefined;

  if (paymentIdReceipt) {
    const existing = await args.admin
      .from("generated_documents")
      .select("id,file_url")
      .eq("deal_id", args.dealId)
      .eq("payment_id", paymentIdReceipt)
      .eq("document_type", "receipt")
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);

    if (existing.data?.id) {
      const oldPath =
        typeof existing.data.file_url === "string" && existing.data.file_url.length > 0
          ? existing.data.file_url
          : "";
      if (oldPath && oldPath !== objectPath) {
        await args.admin.storage.from("contracts").remove([oldPath]);
      }
      const updated = await args.admin
        .from("generated_documents")
        .update({
          file_url: objectPath,
          generated_at: new Date().toISOString(),
          generated_by: args.user.id,
        })
        .eq("id", existing.data.id)
        .select("id")
        .single();
      if (updated.error) throw new Error(updated.error.message);
      return { generated, generatedDocumentId: updated.data.id };
    }
  }

  const inserted = await args.admin
    .from("generated_documents")
    .insert({
      deal_id: args.dealId,
      payment_id: args.mode === "receipt" ? paymentIdReceipt ?? null : null,
      document_type: args.mode,
      file_url: objectPath,
      generated_by: args.user.id,
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return { generated, generatedDocumentId: inserted.data.id };
}
