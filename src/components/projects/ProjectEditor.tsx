import { useState, type FormEvent } from "react";
import { Field, Modal } from "../ui";
import type { Project } from "../../types";
export function ProjectEditor({
  project,
  existingNames,
  onClose,
  onSave,
}: {
  project?: Project;
  existingNames: string[];
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}) {
  const [name, setName] = useState(project?.name || "");
  const [description, setDescription] = useState(project?.description || "");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("请输入项目名称。");
    if (existingNames.some((item) => item.toLocaleLowerCase() === name.trim().toLocaleLowerCase()))
      return setError("已有同名项目，请使用另一个名称。");
    onSave(name.trim(), description.trim());
  }
  return (
    <Modal title={project ? "重命名项目" : "新建项目"} onClose={onClose}>
      <form className="page-form" onSubmit={submit}>
        <Field label="项目名称">
          <input
            autoFocus
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：AI 基础设施"
          />
        </Field>
        {!project && (
          <Field label="说明（可选）">
            <textarea
              rows={3}
              maxLength={300}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="这个项目关注哪些问题？"
            />
          </Field>
        )}
        {error && (
          <p className="page-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="page-form-actions">
          <button type="button" className="page-button" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="page-button page-button-primary">
            {project ? "保存" : "创建项目"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
