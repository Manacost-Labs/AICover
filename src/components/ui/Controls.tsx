import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  ref?: React.Ref<HTMLButtonElement>;
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`studio-button studio-button--${variant} ${className}`}
      {...props}
    />
  );
}

export function Section({
  title,
  action,
  children,
  className = "",
  id,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  const generatedId = React.useId();
  const headingId = id ?? generatedId;
  return (
    <section
      className={`studio-section ${className}`}
      aria-labelledby={headingId}
    >
      <div className="studio-section-heading">
        <h2 id={headingId}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
