import React from "react";
import { OrbitMascotCharacter, OrbitMascotCharacterProps, CharacterState } from "./OrbitMascotCharacter";

export type { CharacterState, OrbitMascotCharacterProps };
export interface OrbitalCoreCharacterProps extends OrbitMascotCharacterProps {}

export const OrbitalCoreCharacter: React.FC<OrbitalCoreCharacterProps> = (props) => {
  return <OrbitMascotCharacter {...props} />;
};

export default OrbitalCoreCharacter;
