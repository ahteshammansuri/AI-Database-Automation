import React from "react";
import { OrbitMascotCharacter, OrbitMascotCharacterProps, CharacterState } from "./OrbitMascotCharacter";

export type { CharacterState, OrbitMascotCharacterProps };
export interface AuraCoreCharacterProps extends OrbitMascotCharacterProps {}

export const AuraCoreCharacter: React.FC<AuraCoreCharacterProps> = (props) => {
  return <OrbitMascotCharacter {...props} />;
};

export default AuraCoreCharacter;
