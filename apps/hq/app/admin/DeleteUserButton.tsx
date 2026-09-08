'use client';

interface DeleteUserButtonProps {
  email: string;
  action: (formData: FormData) => void | Promise<void>;
}

export function DeleteUserButton({ email, action }: DeleteUserButtonProps): JSX.Element {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(`Permanently delete ${email}? This removes the user and revokes their tokens.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="email" value={email} />
      <button
        type="submit"
        className="rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
      >
        Delete
      </button>
    </form>
  );
}
