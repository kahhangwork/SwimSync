import React from "react";
import { ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRegister } from "@/features/register/domain/useRegister";
import { BackLink } from "@/features/register/ui/BackLink";
import { Heading } from "@/features/register/ui/Heading";
import { FormCard } from "@/features/register/ui/FormCard";
import { SignInLink } from "@/features/register/ui/SignInLink";

// Register — composition only (docs/refactor/BATCH_FGH_PLAN.md, App L-H). The form
// state and the submit (whose order is the contract — plan ⚠ R10) live in
// features/register/domain/useRegister, markup in …/ui.
export default function RegisterScreen() {
  const {
    name,
    setName,
    email,
    setEmail,
    phone,
    setPhone,
    address,
    setAddress,
    postal,
    setPostal,
    joinCode,
    setJoinCode,
    password,
    setPassword,
    confirm,
    setConfirm,
    loading,
    error,
    emailSent,
    handleRegister,
  } = useRegister();

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-sky-50"
    >
      <ScrollView
        contentContainerClassName="flex-grow px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <BackLink />

        <Heading />

        <FormCard emailSent={emailSent} email={email} setEmail={setEmail} name={name} setName={setName} phone={phone} setPhone={setPhone} address={address} setAddress={setAddress} postal={postal} setPostal={setPostal} joinCode={joinCode} setJoinCode={setJoinCode} password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} error={error} loading={loading} handleRegister={handleRegister} />

        <SignInLink />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
