import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export function useList<T>(path: string, enabled = true) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api.get<T>(path),
    enabled,
  });
}

export function useOne<T>(path: string, enabled = true) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api.get<T>(path),
    enabled,
  });
}

export function useApiMutation<TBody = unknown, TResult = unknown>(
  fn: (body: TBody) => Promise<TResult>,
  invalidate: string[] = []
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      invalidate.forEach((key) =>
        qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(key) })
      );
    },
  });
}
