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
  const inserted = await args.admin
    .from("generated_documents")
    .insert({
      deal_id: args.dealId,
      payment_id: args.mode === "receipt" ? args.paymentId || null : null,
      document_type: args.mode,
      file_url: objectPath,
      generated_by: args.user.id,
    })
    .select("id")
    .single();
  if (inserted.error) throw new Error(inserted.error.message);
  return { generated, generatedDocumentId: inserted.data.id };
}
